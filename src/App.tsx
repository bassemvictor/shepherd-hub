import { useEffect, useState } from "react";
import { get } from "aws-amplify/api";
import outputs from "../amplify_outputs.json";

type PageKey = "congregation" | "visitation";

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
};

const navItems: { key: PageKey; label: string }[] = [
  { key: "congregation", label: "Congregation" },
  { key: "visitation", label: "Visitation" },
];

type BackendMessage = {
  message: string;
  time: string;
};

const congregationApiName = Object.keys(outputs.custom?.API ?? {})[0];

export default function App() {
  const [activePage, setActivePage] = useState<PageKey>("congregation");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [backendMessage, setBackendMessage] = useState<BackendMessage | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [isBackendLoading, setIsBackendLoading] = useState(false);
  const currentPage = pageContent[activePage];

  useEffect(() => {
    if (!congregationApiName) {
      setBackendError(
        "Backend API is not configured yet. Run the Amplify sandbox and generate outputs.",
      );
      return;
    }

    let isMounted = true;

    const loadBackendMessage = async () => {
      setIsBackendLoading(true);
      setBackendError(null);

      try {
        const restOperation = get({
          apiName: congregationApiName,
          path: "/congregation/message",
        });
        const { body } = await restOperation.response;
        const response = (await body.json()) as BackendMessage;

        if (isMounted) {
          setBackendMessage(response);
        }
      } catch (error) {
        if (isMounted) {
          setBackendError("Unable to load the congregation backend message.");
        }
      } finally {
        if (isMounted) {
          setIsBackendLoading(false);
        }
      }
    };

    void loadBackendMessage();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div className="app-shell">
      <aside className="side-panel">
        <div className="side-panel-header">
          <div>
            <p className="brand-kicker">Shepherd Hub</p>
            <p className="brand-copy">
              Workspace for congregation support and visitation planning.
            </p>
          </div>

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
            </div>
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
