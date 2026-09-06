import { describe, expect, it } from "vitest";
import { resolveRepository } from "./repository-access";
import type { githubRequest } from "../github/service.server";

const selected = { id: 12, installationId: 9, name: "forged/repository", defaultBranch: "forged" };
const repository = {
  id: 12,
  name: "actual",
  full_name: "owner/actual",
  private: true,
  default_branch: "main",
  archived: false,
};

describe("repository authorization", () => {
  it("uses the user's installation access and canonical GitHub repository metadata", async () => {
    const read: typeof githubRequest = async (userId, path, schema) => {
      expect(userId).toBe("user-a");
      expect(path).toBe("/user/installations/9/repositories?per_page=100&page=1");
      return schema.parse({ total_count: 1, repositories: [repository] });
    };
    expect(await resolveRepository("user-a", selected, read)).toEqual({
      id: 12,
      installationId: 9,
      name: "owner/actual",
      defaultBranch: "main",
    });
  });

  it("checks subsequent pages instead of trusting a client-supplied name", async () => {
    const read: typeof githubRequest = async (_userId, path, schema) =>
      schema.parse({ total_count: 101, repositories: path.endsWith("page=2") ? [repository] : [] });
    expect((await resolveRepository("user-a", selected, read)).id).toBe(12);
  });

  it("rejects repositories absent from the authorized installation", async () => {
    const read: typeof githubRequest = async (_userId, _path, schema) =>
      schema.parse({ total_count: 0, repositories: [] });
    await expect(resolveRepository("user-a", selected, read)).rejects.toThrow(
      "no longer accessible",
    );
  });

  it("rejects archived repositories", async () => {
    const read: typeof githubRequest = async (_userId, _path, schema) =>
      schema.parse({ total_count: 1, repositories: [{ ...repository, archived: true }] });
    await expect(resolveRepository("user-a", selected, read)).rejects.toThrow("archived");
  });
});
