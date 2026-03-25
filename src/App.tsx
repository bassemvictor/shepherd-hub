import { useEffect, useState, type FormEvent } from "react";
import { get, post } from "aws-amplify/api";
import { getCurrentUser, signIn, signOut } from "aws-amplify/auth";
import outputs from "../amplify_outputs.json";

type PageKey = "congregation" | "visitation" | "new-member";

const pageContent: Record<
  PageKey,
  { eyebrow: string; description: string; highlights: string[] }
> = {
  congregation: {
    eyebrow: "Congregation",
    description:
      "Track members, responsibilities, and updates from a single dashboard built for day-to-day congregation work.",
    highlights: [
      "Shared view of assignments and follow-ups",
      "Quick access to member notes and important updates",
      "Simple layout for weekly coordination",
    ],
  },
  visitation: {
    eyebrow: "Visitation",
    description:
      "Organize upcoming visits, remember special circumstances, and keep a clear history of care and encouragement.",
    highlights: [
      "Prepare upcoming visits with relevant context",
      "Capture notes right after each conversation",
      "See who may need another visit soon",
    ],
  },
  "new-member": {
    eyebrow: "New Member",
    description:
      "Capture the basic details for a congregation member before wiring the form to backend storage.",
    highlights: [
      "Collect identity and contact details in one place",
      "Leave room for role and assignment notes",
      "Prepare a clean UI for later backend integration",
    ],
  },
};

const navItems: { key: PageKey; label: string }[] = [
  { key: "congregation", label: "Congregation" },
  { key: "visitation", label: "Visitation" },
  { key: "new-member", label: "Add Member" },
];

type BackendMessage = {
  message: string;
  time: string;
  items: Array<{
    pk: string;
    sk: string;
    data: string;
  }>;
};

type MemberFormState = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: string;
  status: string;
  address: string;
  notes: string;
};

type StoredMemberData = Partial<MemberFormState> & {
  createdAt?: string;
};

const congregationApiName = Object.keys(outputs.custom?.API ?? {})[0];
const initialMemberForm: MemberFormState = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  role: "",
  status: "",
  address: "",
  notes: "",
};

const parseMemberData = (value: string): StoredMemberData | null => {
  try {
    return JSON.parse(value) as StoredMemberData;
  } catch {
    return null;
  }
};

export default function App() {
  const [authStatus, setAuthStatus] = useState<"checking" | "signed-in" | "signed-out">(
    "checking",
  );
  const [authForm, setAuthForm] = useState({
    username: "",
    password: "",
  });
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [currentUserLabel, setCurrentUserLabel] = useState<string>("");
  const [activePage, setActivePage] = useState<PageKey>("congregation");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [backendMessage, setBackendMessage] = useState<BackendMessage | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [isBackendLoading, setIsBackendLoading] = useState(false);
  const [memberForm, setMemberForm] = useState<MemberFormState>(initialMemberForm);
  const [memberSubmitState, setMemberSubmitState] = useState<string | null>(null);
  const [isMemberSubmitting, setIsMemberSubmitting] = useState(false);
  const currentPage = pageContent[activePage];

  const checkAuthSession = async () => {
    try {
      const user = await getCurrentUser();
      setCurrentUserLabel(user.signInDetails?.loginId ?? user.username);
      setAuthStatus("signed-in");
    } catch {
      setAuthStatus("signed-out");
    }
  };

  const loadBackendMessage = async () => {
    if (!congregationApiName) {
      setBackendError(
        "Backend API is not configured yet. Run the Amplify sandbox and generate outputs.",
      );
      return;
    }

    setIsBackendLoading(true);
    setBackendError(null);

    try {
      const restOperation = get({
        apiName: congregationApiName,
        path: "/congregation/message",
      });
      const { body } = await restOperation.response;
      const response = (await body.json()) as BackendMessage;
      setBackendMessage(response);
    } catch (error) {
      setBackendError("Unable to load the congregation backend message.");
    } finally {
      setIsBackendLoading(false);
    }
  };

  useEffect(() => {
    void checkAuthSession();
  }, []);

  useEffect(() => {
    if (authStatus !== "signed-in") {
      return;
    }

    if (!congregationApiName) {
      setBackendError(
        "Backend API is not configured yet. Run the Amplify sandbox and generate outputs.",
      );
      return;
    }

    let isMounted = true;

    void (async () => {
      await loadBackendMessage();
      if (!isMounted) {
        return;
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [authStatus]);

  const updateMemberForm = (
    field: keyof MemberFormState,
    value: MemberFormState[keyof MemberFormState],
  ) => {
    setMemberForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleMemberSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!congregationApiName) {
      setMemberSubmitState("Backend API is not configured yet.");
      return;
    }

    setIsMemberSubmitting(true);
    setMemberSubmitState(null);

    try {
      const restOperation = post({
        apiName: congregationApiName,
        path: "/congregation/member",
        options: {
          body: memberForm,
        },
      });
      await restOperation.response;
      setMemberSubmitState("Member saved.");
      setMemberForm(initialMemberForm);
      await loadBackendMessage();
      setActivePage("congregation");
    } catch (error) {
      setMemberSubmitState("Unable to save member.");
    } finally {
      setIsMemberSubmitting(false);
    }
  };

  const handleSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSigningIn(true);
    setAuthError(null);

    try {
      const result = await signIn({
        username: authForm.username,
        password: authForm.password,
      });

      if (result.nextStep.signInStep !== "DONE") {
        setAuthError("Additional sign-in steps are required for this user.");
        setIsSigningIn(false);
        return;
      }

      await checkAuthSession();
    } catch {
      setAuthError("Unable to sign in with those credentials.");
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    setAuthStatus("signed-out");
    setCurrentUserLabel("");
    setBackendMessage(null);
    setBackendError(null);
  };

  if (authStatus !== "signed-in") {
    return (
      <div className="auth-shell">
        <form className="auth-card" onSubmit={handleSignIn}>
          <p className="eyebrow">Shepherd Hub</p>
          <h1 className="auth-title">Sign in to continue</h1>
          <p className="auth-copy">
            Use your Cognito username and password to access Shephed Hub.
          </p>

          <label className="auth-field">
            <span>Username</span>
            <input
              type="text"
              value={authForm.username}
              onChange={(event) =>
                setAuthForm((current) => ({
                  ...current,
                  username: event.target.value,
                }))
              }
              placeholder="Enter your username"
            />
          </label>

          <label className="auth-field">
            <span>Password</span>
            <input
              type="password"
              value={authForm.password}
              onChange={(event) =>
                setAuthForm((current) => ({
                  ...current,
                  password: event.target.value,
                }))
              }
              placeholder="Enter your password"
            />
          </label>

          {authError ? <p className="auth-error">{authError}</p> : null}

          <button
            type="submit"
            className="auth-submit-button"
            disabled={isSigningIn || authStatus === "checking"}
          >
            {authStatus === "checking" || isSigningIn ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="side-panel">
        <div className="side-panel-header">
          <button
            type="button"
            className={`menu-toggle${isMobileMenuOpen ? " open" : ""}`}
            aria-expanded={isMobileMenuOpen}
            aria-controls="home-sections-nav"
            aria-label="Toggle navigation menu"
            onClick={() => setIsMobileMenuOpen((current) => !current)}
          >
            <span />
            <span />
            <span />
          </button>

          <div>
            <p className="brand-kicker">Shepherd Hub</p>
            <p className="signed-in-user">{currentUserLabel}</p>
          </div>
        </div>

        <nav
          id="home-sections-nav"
          className={`nav-list${isMobileMenuOpen ? " open" : ""}`}
          aria-label="Home sections"
        >
          {navItems.map((item) => {
            const isActive = item.key === activePage;

            return (
              <button
                key={item.key}
                type="button"
                className={`nav-item${isActive ? " active" : ""}`}
                onClick={() => {
                  setActivePage(item.key);
                  setIsMobileMenuOpen(false);
                }}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <button type="button" className="sign-out-button" onClick={handleSignOut}>
          Sign Out
        </button>
      </aside>

      <main className="content-panel">
        <section className="hero-card">
          <p className="eyebrow">{currentPage.eyebrow}</p>
          <p className="description">{currentPage.description}</p>

          {activePage === "congregation" ? (
            <div className="api-message-card">
              <p className="api-message-label">Backend message</p>
              <p className="api-message-text">
                {isBackendLoading
                  ? "Loading message from Lambda..."
                  : backendError ?? backendMessage?.message}
              </p>

              {!isBackendLoading && !backendError && backendMessage ? (
                <div className="api-data-list">
                  {backendMessage.items.map((item) => {
                    const memberData = parseMemberData(item.data);
                    const fullName = [memberData?.firstName, memberData?.lastName]
                      .filter(Boolean)
                      .join(" ");

                    return (
                      <article className="api-data-item" key={`${item.pk}-${item.sk}`}>
                        <p className="api-data-key">
                          {item.pk} / {item.sk}
                        </p>

                        {memberData ? (
                          <div className="api-data-details">
                            <p className="api-data-name">{fullName || "Unnamed member"}</p>
                            <div className="api-data-meta">
                              <span>{memberData.role || "No role"}</span>
                              <span>{memberData.status || "No status"}</span>
                            </div>
                          </div>
                        ) : (
                          <p className="api-data-value">{item.data}</p>
                        )}
                      </article>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}

          {activePage === "new-member" ? (
            <form className="member-form-card" onSubmit={handleMemberSubmit}>
              <div className="member-form-grid">
                <label className="member-field">
                  <span>First name</span>
                  <input
                    type="text"
                    placeholder="John"
                    value={memberForm.firstName}
                    onChange={(event) =>
                      updateMemberForm("firstName", event.target.value)
                    }
                  />
                </label>

                <label className="member-field">
                  <span>Last name</span>
                  <input
                    type="text"
                    placeholder="Smith"
                    value={memberForm.lastName}
                    onChange={(event) =>
                      updateMemberForm("lastName", event.target.value)
                    }
                  />
                </label>

                <label className="member-field">
                  <span>Email</span>
                  <input
                    type="email"
                    placeholder="john@example.com"
                    value={memberForm.email}
                    onChange={(event) =>
                      updateMemberForm("email", event.target.value)
                    }
                  />
                </label>

                <label className="member-field">
                  <span>Phone</span>
                  <input
                    type="tel"
                    placeholder="+1 (555) 555-5555"
                    value={memberForm.phone}
                    onChange={(event) =>
                      updateMemberForm("phone", event.target.value)
                    }
                  />
                </label>

                <label className="member-field">
                  <span>Role</span>
                  <select
                    value={memberForm.role}
                    onChange={(event) => updateMemberForm("role", event.target.value)}
                  >
                    <option value="" disabled>
                      Select a role
                    </option>
                    <option>Elder</option>
                    <option>Ministerial Servant</option>
                    <option>Publisher</option>
                    <option>Pioneer</option>
                  </select>
                </label>

                <label className="member-field">
                  <span>Status</span>
                  <select
                    value={memberForm.status}
                    onChange={(event) =>
                      updateMemberForm("status", event.target.value)
                    }
                  >
                    <option value="" disabled>
                      Select a status
                    </option>
                    <option>Active</option>
                    <option>Needs Follow-up</option>
                    <option>Inactive</option>
                  </select>
                </label>

                <label className="member-field member-field-full">
                  <span>Address</span>
                  <input
                    type="text"
                    placeholder="123 Main Street"
                    value={memberForm.address}
                    onChange={(event) =>
                      updateMemberForm("address", event.target.value)
                    }
                  />
                </label>

                <label className="member-field member-field-full">
                  <span>Notes</span>
                  <textarea
                    rows={4}
                    placeholder="Assignment notes, visitation reminders, or special circumstances"
                    value={memberForm.notes}
                    onChange={(event) =>
                      updateMemberForm("notes", event.target.value)
                    }
                  />
                </label>
              </div>

              <div className="member-form-actions">
                {memberSubmitState ? (
                  <p className="member-submit-message">{memberSubmitState}</p>
                ) : null}
                <button
                  type="submit"
                  className="member-submit-button"
                  disabled={isMemberSubmitting}
                >
                  {isMemberSubmitting ? "Saving..." : "Save Member"}
                </button>
              </div>
            </form>
          ) : null}
        </section>

        <section className="details-grid">
          {currentPage.highlights.map((highlight) => (
            <article className="detail-card" key={highlight}>
              <span className="detail-index">•</span>
              <p>{highlight}</p>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
