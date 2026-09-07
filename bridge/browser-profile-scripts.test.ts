import { afterAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { z } from "zod";
import { browserProfileDirectory } from "./contracts";
import {
  captureBrowserProfileScript,
  restoreBrowserProfileScript,
} from "./browser-profile-scripts";

const root = mkdtempSync(join(tmpdir(), "sparkles-browser-profile-test-"));
const profile = join(root, "source");
const restored = join(root, "restored");

afterAll(() => rmSync(root, { recursive: true, force: true }));

const scriptFor = (script: string, directory: string) =>
  script.replaceAll(JSON.stringify(browserProfileDirectory), JSON.stringify(directory));

describe("browser profile archive", () => {
  it("captures browser state while excluding component downloads and process locks", () => {
    mkdirSync(join(profile, "Default", "Local Storage", "leveldb"), { recursive: true });
    mkdirSync(join(profile, "Default", "IndexedDB", "site"), { recursive: true });
    mkdirSync(join(profile, "component_crx_cache"), { recursive: true });
    writeFileSync(join(profile, "Local State"), "local-state");
    writeFileSync(join(profile, "Default", "Cookies"), "cookie-data");
    writeFileSync(join(profile, "Default", "Local Storage", "leveldb", "000003.log"), "local");
    writeFileSync(join(profile, "Default", "IndexedDB", "site", "000003.log"), "indexed");
    writeFileSync(join(profile, "SingletonLock"), "lock");
    writeFileSync(join(profile, "component_crx_cache", "download"), "x".repeat(1024));

    const id = randomUUID();
    const result = spawnSync("python3", ["-c", scriptFor(captureBrowserProfileScript, profile)], {
      input: JSON.stringify({ id }),
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    const output = z
      .object({ present: z.boolean(), metadata: z.object({ size: z.number() }) })
      .parse(JSON.parse(result.stdout));
    expect(output.present).toBe(true);

    const archivePath = `/tmp/sparkles-browser-profile-${id}.tar.gz`;
    const listing = spawnSync("tar", ["-tzf", archivePath], { encoding: "utf8" });
    expect(listing.stdout).toContain("profile/Default/Cookies");
    expect(listing.stdout).toContain("profile/Default/Local Storage/leveldb/000003.log");
    expect(listing.stdout).toContain("profile/Default/IndexedDB/site/000003.log");
    expect(listing.stdout).not.toContain("component_crx_cache");
    expect(listing.stdout).not.toContain("SingletonLock");
    rmSync(archivePath, { force: true });
  });

  it.each([
    ["../escape", "file"],
    ["profile/link", "symlink"],
    ["profile/hard-link", "hardlink"],
  ])("rejects unsafe archive entry %s", (entry, kind) => {
    const archivePath = join(root, `${kind}.tar.gz`);
    const build = spawnSync(
      "python3",
      [
        "-c",
        "import io,sys,tarfile; p,n,k=sys.argv[1:]; t=tarfile.open(p,'w:gz'); i=tarfile.TarInfo(n); i.type={'symlink':tarfile.SYMTYPE,'hardlink':tarfile.LNKTYPE}.get(k,tarfile.REGTYPE); i.linkname='/tmp/target'; i.size=1 if k=='file' else 0; t.addfile(i,io.BytesIO(b'x')); t.close()",
        archivePath,
        entry,
        kind,
      ],
      { encoding: "utf8" },
    );
    expect(build.status, build.stderr).toBe(0);
    const archive = readFileSync(archivePath);
    mkdirSync(restored, { recursive: true });
    writeFileSync(join(restored, "preserved"), "yes");
    const metadata = {
      id: randomUUID(),
      createdAt: Date.now(),
      size: archive.byteLength,
      sha256: createHash("sha256").update(archive).digest("hex"),
    };
    const result = spawnSync(
      "python3",
      [
        "-c",
        scriptFor(restoreBrowserProfileScript, restored),
        JSON.stringify({ profile: metadata }),
      ],
      { input: archive, encoding: "buffer" },
    );
    expect(result.status).not.toBe(0);
    expect(readFileSync(join(restored, "preserved"), "utf8")).toBe("yes");
  });
});
