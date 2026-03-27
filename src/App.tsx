import { useEffect, useRef, useState, type FormEvent } from "react";
import { get, post } from "aws-amplify/api";
import { confirmSignIn, getCurrentUser, signIn, signOut } from "aws-amplify/auth";
import outputs from "../amplify_outputs.json";

type PageKey = "congregation" | "visitation" | "new-member";

const pageContent: Record<
  PageKey,
  { eyebrow: string; description: string }
> = {
  congregation: {
    eyebrow: "Congregation",
    description:
      "Track members, responsibilities, and updates from a single dashboard built for day-to-day congregation work.",
  },
  visitation: {
    eyebrow: "Visitation",
    description:
      "Organize upcoming visits, remember special circumstances, and keep a clear history of care and encouragement.",
  },
  "new-member": {
    eyebrow: "New Member",
    description:
      "Capture the basic details for a congregation member.",
  },
};

const navSections: Array<{
  label: string;
  items: Array<{ key: PageKey; label: string }>;
}> = [
  {
    label: "Workspace",
    items: [
      { key: "congregation", label: "Congregation" },
      { key: "visitation", label: "Visitation" },
    ],
  },
  {
    label: "Manage",
    items: [],
  },
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

type VisitationActionState = {
  scheduled?: boolean;
  noted?: boolean;
  completed?: boolean;
};

type VisitationModalState = {
  action: "schedule" | "note" | "complete";
  memberKey: string;
  memberName: string;
} | null;

type DeleteModalState = {
  pk: string;
  sk: string;
  memberName: string;
} | null;

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
  const sidePanelRef = useRef<HTMLElement | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [pendingSignInStep, setPendingSignInStep] = useState<string | null>(null);
  const [challengeResponse, setChallengeResponse] = useState("");
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
  const [memberSearch, setMemberSearch] = useState("");
  const [memberForm, setMemberForm] = useState<MemberFormState>(initialMemberForm);
  const [memberSubmitState, setMemberSubmitState] = useState<string | null>(null);
  const [isMemberSubmitting, setIsMemberSubmitting] = useState(false);
  const [deletingMemberKey, setDeletingMemberKey] = useState<string | null>(null);
  const [visitationActions, setVisitationActions] = useState<
    Record<string, VisitationActionState>
  >({});
  const [visitationModal, setVisitationModal] = useState<VisitationModalState>(null);
  const [visitationSchedule, setVisitationSchedule] = useState("");
  const [visitationNote, setVisitationNote] = useState("");
  const [deleteModal, setDeleteModal] = useState<DeleteModalState>(null);
  const currentPage = pageContent[activePage];
  const normalizedMemberSearch = memberSearch.trim().toLowerCase();
  const filteredCongregationItems =
    backendMessage?.items.filter((item) => {
      if (!normalizedMemberSearch) {
        return true;
      }

      const memberData = parseMemberData(item.data);
      const haystack = [
        item.pk,
        item.sk,
        item.data,
        memberData?.firstName,
        memberData?.lastName,
        memberData?.email,
        memberData?.phone,
        memberData?.role,
        memberData?.status,
        memberData?.address,
        memberData?.notes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedMemberSearch);
    }) ?? [];

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
    const savedTheme = window.localStorage.getItem("shepherd-hub-theme");

    if (savedTheme === "light" || savedTheme === "dark") {
      setTheme(savedTheme);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("shepherd-hub-theme", theme);
  }, [theme]);

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

  useEffect(() => {
    if (!isMobileMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (!sidePanelRef.current) {
        return;
      }

      const target = event.target;

      if (target instanceof Node && !sidePanelRef.current.contains(target)) {
        setIsMobileMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [isMobileMenuOpen]);

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

  const handleDeleteMember = async (pk: string, sk: string) => {
    if (!congregationApiName) {
      return;
    }

    const memberKey = `${pk}-${sk}`;
    setDeletingMemberKey(memberKey);

    try {
      const restOperation = post({
        apiName: congregationApiName,
        path: "/congregation/member/remove",
        options: {
          body: { pk, sk },
        },
      });
      await restOperation.response;
      await loadBackendMessage();
    } finally {
      setDeletingMemberKey(null);
    }
  };

  const openDeleteModal = (pk: string, sk: string, memberName: string) => {
    setDeleteModal({
      pk,
      sk,
      memberName,
    });
  };

  const closeDeleteModal = () => {
    setDeleteModal(null);
  };

  const confirmDeleteMember = async () => {
    if (!deleteModal) {
      return;
    }

    await handleDeleteMember(deleteModal.pk, deleteModal.sk);
    closeDeleteModal();
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
        setPendingSignInStep(result.nextStep.signInStep);
        return;
      }

      setPendingSignInStep(null);
      setChallengeResponse("");
      await checkAuthSession();
    } catch {
      setAuthError("Unable to sign in with those credentials.");
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleConfirmSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSigningIn(true);
    setAuthError(null);

    try {
      const result = await confirmSignIn({
        challengeResponse,
      });

      if (result.nextStep.signInStep !== "DONE") {
        setPendingSignInStep(result.nextStep.signInStep);
        setAuthError(`Another sign-in step is required: ${result.nextStep.signInStep}.`);
        return;
      }

      setPendingSignInStep(null);
      setChallengeResponse("");
      await checkAuthSession();
    } catch {
      setAuthError("Unable to complete the sign-in challenge.");
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

  const toggleTheme = () => {
    setTheme((current) => (current === "light" ? "dark" : "light"));
  };

  const applyVisitationAction = (
    memberKey: string,
    action: keyof VisitationActionState,
  ) => {
    setVisitationActions((current) => ({
      ...current,
      [memberKey]: {
        ...current[memberKey],
        [action]: true,
      },
    }));
  };

  const openVisitationModal = (
    action: NonNullable<VisitationModalState>["action"],
    memberKey: string,
    memberName: string,
  ) => {
    setVisitationModal({
      action,
      memberKey,
      memberName,
    });
    setVisitationSchedule("");
    setVisitationNote("");
  };

  const closeVisitationModal = () => {
    setVisitationModal(null);
    setVisitationSchedule("");
    setVisitationNote("");
  };

  const handleVisitationModalSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!visitationModal) {
      return;
    }

    if (visitationModal.action === "schedule") {
      applyVisitationAction(visitationModal.memberKey, "scheduled");
    }

    if (visitationModal.action === "note") {
      applyVisitationAction(visitationModal.memberKey, "noted");
    }

    if (visitationModal.action === "complete") {
      applyVisitationAction(visitationModal.memberKey, "completed");
    }

    closeVisitationModal();
  };

  if (authStatus !== "signed-in") {
    const challengeLabel =
      pendingSignInStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED"
        ? "New password"
        : pendingSignInStep === "CONFIRM_SIGN_IN_WITH_EMAIL_CODE"
          ? "Email verification code"
          : pendingSignInStep === "CONFIRM_SIGN_IN_WITH_SMS_CODE"
            ? "SMS verification code"
            : pendingSignInStep === "CONFIRM_SIGN_IN_WITH_TOTP_CODE"
              ? "Authenticator code"
              : "Challenge response";

    return (
      <div className="auth-shell" data-theme={theme}>
        <form
          className="auth-card"
          onSubmit={pendingSignInStep ? handleConfirmSignIn : handleSignIn}
        >
          <p className="eyebrow">Shepherd Hub</p>
          <h1 className="auth-title">Sign in to continue</h1>
          <p className="auth-copy">
            Use your Cognito username and password to access Shephed Hub.
          </p>

          {!pendingSignInStep ? (
            <>
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
            </>
          ) : (
            <>
              <label className="auth-field">
                <span>{challengeLabel}</span>
                <input
                  type={
                    pendingSignInStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED"
                      ? "password"
                      : "text"
                  }
                  value={challengeResponse}
                  onChange={(event) => setChallengeResponse(event.target.value)}
                  placeholder={`Enter ${challengeLabel.toLowerCase()}`}
                />
              </label>
            </>
          )}

          {authError ? <p className="auth-error">{authError}</p> : null}

          <button
            type="submit"
            className="auth-submit-button"
            disabled={isSigningIn || authStatus === "checking"}
          >
            {authStatus === "checking" || isSigningIn
              ? "Signing in..."
              : pendingSignInStep
                ? "Continue Sign In"
                : "Sign In"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="app-shell" data-theme={theme}>
      <aside className="side-panel" ref={sidePanelRef}>
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

          <div className="side-panel-brand">
            <p className="brand-kicker">Shepherd Hub</p>
            <p className="signed-in-user">{currentUserLabel}</p>
          </div>

          <img className="side-panel-logo" src="/logo.png" alt="Shepherd Hub logo" />
        </div>

        <nav
          id="home-sections-nav"
          className={`nav-list${isMobileMenuOpen ? " open" : ""}`}
          aria-label="Home sections"
        >
          {navSections
            .filter((section) => section.items.length > 0)
            .map((section) => (
              <div className="nav-section" key={section.label}>
                <p className="nav-section-label">{section.label}</p>

                <div className="nav-section-items">
                  {section.items.map((item) => {
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
                </div>
              </div>
            ))}

          <div className="nav-section">
            <p className="nav-section-label">Session</p>
            <div className="nav-section-items">
              <button
                type="button"
                className="nav-item theme-toggle-button"
                onClick={toggleTheme}
              >
                {theme === "light" ? "Dark Mode" : "Light Mode"}
              </button>
              <button
                type="button"
                className="nav-item sign-out-button"
                onClick={handleSignOut}
              >
                Sign Out
              </button>
            </div>
          </div>
        </nav>
      </aside>

      <main className="content-panel">
        <section className="hero-card">
          <div className="hero-header">
            <div>
              <p className="eyebrow">{currentPage.eyebrow}</p>
              <p className="description">{currentPage.description}</p>
            </div>

            {activePage === "congregation" ? (
              <button
                type="button"
                className="hero-action-button"
                onClick={() => setActivePage("new-member")}
              >
                Add Member
              </button>
            ) : null}
          </div>

          {activePage === "congregation" ? (
            <div className="api-message-card">
              <p className="api-message-label">Backend message</p>
              <p className="api-message-text">
                {isBackendLoading
                  ? "Loading message from Lambda..."
                  : backendError ?? backendMessage?.message}
              </p>

              {!isBackendLoading && !backendError && backendMessage ? (
                <>
                  <div className="congregation-search-row">
                    <input
                      type="search"
                      className="congregation-search-input"
                      placeholder="Search members"
                      value={memberSearch}
                      onChange={(event) => setMemberSearch(event.target.value)}
                    />
                    <p className="congregation-search-count">
                      {filteredCongregationItems.length} member
                      {filteredCongregationItems.length === 1 ? "" : "s"}
                    </p>
                  </div>

                  <div className="api-data-list">
                    {filteredCongregationItems.map((item) => {
                      const memberData = parseMemberData(item.data);
                      const fullName = [memberData?.firstName, memberData?.lastName]
                        .filter(Boolean)
                        .join(" ");

                      return (
                        <article className="api-data-item" key={`${item.pk}-${item.sk}`}>
                          <div className="api-data-row">
                            <p className="api-data-key">
                              {item.pk} / {item.sk}
                            </p>

                            <button
                              type="button"
                              className="api-delete-button"
                              onClick={() =>
                                openDeleteModal(
                                  item.pk,
                                  item.sk,
                                  fullName || `${item.pk} / ${item.sk}`,
                                )
                              }
                              disabled={deletingMemberKey === `${item.pk}-${item.sk}`}
                            >
                              {deletingMemberKey === `${item.pk}-${item.sk}`
                                ? "Deleting..."
                                : "Delete"}
                            </button>
                          </div>

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

                    {filteredCongregationItems.length === 0 ? (
                      <p className="congregation-empty-state">
                        No members match your search.
                      </p>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          {activePage === "visitation" ? (
            <div className="visitation-board">
              {backendMessage?.items.map((item) => {
                const memberData = parseMemberData(item.data);
                const memberKey = `${item.pk}-${item.sk}`;
                const fullName = [memberData?.firstName, memberData?.lastName]
                  .filter(Boolean)
                  .join(" ");
                const actionState = visitationActions[memberKey] ?? {};

                return (
                  <article className="visitation-card" key={memberKey}>
                    <div className="visitation-card-top">
                      <div>
                        <p className="visitation-member-key">
                          {item.pk} / {item.sk}
                        </p>
                        <p className="visitation-member-name">
                          {fullName || "Unnamed member"}
                        </p>
                      </div>
                    </div>

                    <div className="visitation-actions">
                      <button
                        type="button"
                        className={`visitation-action-button${
                          actionState.scheduled ? " active" : ""
                        } visitation-action-schedule`}
                        onClick={() =>
                          openVisitationModal(
                            "schedule",
                            memberKey,
                            fullName || "Unnamed member",
                          )
                        }
                      >
                        <span>Schedule</span>
                      </button>

                      <button
                        type="button"
                        className={`visitation-action-button${
                          actionState.noted ? " active" : ""
                        } visitation-action-note`}
                        onClick={() =>
                          openVisitationModal(
                            "note",
                            memberKey,
                            fullName || "Unnamed member",
                          )
                        }
                      >
                        <span>Add Note</span>
                      </button>

                      <button
                        type="button"
                        className={`visitation-action-button${
                          actionState.completed ? " active" : ""
                        } visitation-action-complete`}
                        onClick={() =>
                          openVisitationModal(
                            "complete",
                            memberKey,
                            fullName || "Unnamed member",
                          )
                        }
                      >
                        <span>Mark Done</span>
                      </button>
                    </div>
                  </article>
                );
              })}
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
      </main>

      {visitationModal ? (
        <div className="modal-overlay" role="presentation" onClick={closeVisitationModal}>
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="Visitation action"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="eyebrow">{visitationModal.memberName}</p>
            <h2 className="modal-title">
              {visitationModal.action === "schedule"
                ? "Schedule visitation"
                : visitationModal.action === "note"
                  ? "Add visitation note"
                  : "Mark visitation done"}
            </h2>

            <form className="modal-form" onSubmit={handleVisitationModalSubmit}>
              {visitationModal.action === "schedule" ? (
                <label className="member-field">
                  <span>Visitation date</span>
                  <input
                    type="datetime-local"
                    value={visitationSchedule}
                    onChange={(event) => setVisitationSchedule(event.target.value)}
                    required
                  />
                </label>
              ) : null}

              {visitationModal.action === "note" ? (
                <label className="member-field">
                  <span>Visitation note</span>
                  <textarea
                    rows={5}
                    value={visitationNote}
                    onChange={(event) => setVisitationNote(event.target.value)}
                    placeholder="Add a summary of the visit or planned follow-up"
                    required
                  />
                </label>
              ) : null}

              {visitationModal.action === "complete" ? (
                <p className="modal-copy">
                  Confirm that the visitation for {visitationModal.memberName} has been
                  completed.
                </p>
              ) : null}

              <div className="modal-actions">
                <button type="button" className="modal-secondary-button" onClick={closeVisitationModal}>
                  Cancel
                </button>
                <button type="submit" className="member-submit-button">
                  {visitationModal.action === "complete" ? "Confirm" : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {deleteModal ? (
        <div className="modal-overlay" role="presentation" onClick={closeDeleteModal}>
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="Delete member confirmation"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="eyebrow">Delete Member</p>
            <h2 className="modal-title">{deleteModal.memberName}</h2>
            <p className="modal-copy">
              Remove this member from the congregation list? This action cannot be
              undone.
            </p>

            <div className="modal-actions">
              <button
                type="button"
                className="modal-secondary-button"
                onClick={closeDeleteModal}
              >
                Cancel
              </button>
              <button
                type="button"
                className="modal-danger-button"
                onClick={confirmDeleteMember}
                disabled={deletingMemberKey === `${deleteModal.pk}-${deleteModal.sk}`}
              >
                {deletingMemberKey === `${deleteModal.pk}-${deleteModal.sk}`
                  ? "Deleting..."
                  : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
