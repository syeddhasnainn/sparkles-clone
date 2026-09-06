import { useAccount } from "@/hooks/use-account";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Link } from "@tanstack/react-router";
import { AccountAvatar } from "@/components/dashboard/account-avatar";
import { SettingsHeading } from "./settings-heading";
import { SettingsSection } from "./settings-section";
import { AppearanceSettings } from "./appearance-settings";
import { CloudBrowserSettings } from "./cloud-browser-settings";
import { PrivacyDialog } from "./privacy-dialog";

function ProfileSettings() {
  const user = useAccount();
  return (
    <SettingsSection title="Profile" description="Your profile is synced from WorkOS.">
      <div className="profile-panel">
        <AccountAvatar size="large" />
        <div>
          <p className="profile-name">{user.name}</p>
          <p className="profile-email">{user.email}</p>
        </div>
        <SignOutButton />
      </div>
    </SettingsSection>
  );
}

function RelatedSettings() {
  return (
    <SettingsSection title="Elsewhere">
      <div className="related-settings">
        <Link to="/app/settings/memories">
          <span>What the agent remembers about you</span>
          <span>Memories</span>
        </Link>
        <div className="related-settings-row" aria-disabled="true">
          <span>Accounts you have connected</span>
          <span>Integrations</span>
        </div>
        <p>Model, reasoning effort, and Fast mode are chosen in the chat composer.</p>
      </div>
    </SettingsSection>
  );
}

export function AccountSettings() {
  return (
    <>
      <SettingsHeading title="Account" description="Your profile, appearance, and saved logins." />
      <div className="settings-scroll" data-scroll-restoration-id="settings-content">
        <div className="settings-content">
          <ProfileSettings />
          <AppearanceSettings />
          <CloudBrowserSettings />
          <SettingsSection
            title="Privacy"
            description="Control optional product analytics and session replay."
          >
            <div className="settings-action-panel">
              <p>Review your choices or withdraw optional consent at any time.</p>
              <PrivacyDialog />
            </div>
          </SettingsSection>
          <RelatedSettings />
        </div>
      </div>
    </>
  );
}
