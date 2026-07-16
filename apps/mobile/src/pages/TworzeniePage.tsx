import type { ComponentType } from "react";
import { useSearchParams } from "react-router-dom";
import { KalendarzSection } from "./tworzenie/KalendarzSection";
import { PostSection } from "./tworzenie/PostSection";
import { StronaSection } from "./tworzenie/StronaSection";
import { ReelsSection } from "./tworzenie/ReelsSection";
import { IconKalendarz, IconPost, IconReels, IconStrona } from "./tworzenie/TworzenieIcons";
import { FEATURE_FLAGS } from "../lib/featureFlags";

type SectionKey = "kalendarz" | "post" | "strona" | "reels";

interface SectionDef {
  key: SectionKey;
  label: string;
  sublabel: string;
  Icon: ComponentType<{ className?: string }>;
  Component: ComponentType;
  /** Funkcja tymczasowo zablokowana - widoczna w hubie jako "Wkrótce", niedostępna do otwarcia. */
  comingSoon?: boolean;
}

const SECTIONS: SectionDef[] = [
  {
    key: "kalendarz",
    label: "Kalendarz treści",
    sublabel: "Zaplanowane posty i reels",
    Icon: IconKalendarz,
    Component: KalendarzSection,
  },
  {
    key: "post",
    label: "Post social media",
    sublabel: "Nowy post z pomocą AI",
    Icon: IconPost,
    Component: PostSection,
  },
  {
    key: "strona",
    label: "Post na stronę",
    sublabel: "Artykuł na Twoją stronę",
    Icon: IconStrona,
    Component: StronaSection,
    comingSoon: FEATURE_FLAGS.tworzenieStrona,
  },
  {
    key: "reels",
    label: "Reels",
    sublabel: "Wideo na social media",
    Icon: IconReels,
    Component: ReelsSection,
    comingSoon: FEATURE_FLAGS.tworzenieReels,
  },
];

export function TworzeniePage() {
  // Kept in the URL (?sekcja=...) so an open section is shareable/bookmarkable.
  const [searchParams, setSearchParams] = useSearchParams();
  const activeKey = searchParams.get("sekcja") as SectionKey | null;
  const activeSection = SECTIONS.find((section) => section.key === activeKey && !section.comingSoon) ?? null;

  const openSection = (key: SectionKey) => setSearchParams({ sekcja: key });
  const closeSection = () => setSearchParams({});

  if (activeSection) {
    const ActiveComponent = activeSection.Component;
    return (
      <div>
        <div className="section-header">
          <button type="button" className="section-back" aria-label="Wróć do menu" onClick={closeSection}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 12H5" />
              <path d="M12 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="section-header-title">{activeSection.label}</h1>
        </div>
        <ActiveComponent />
      </div>
    );
  }

  return (
    <div>
      <h1 className="page-title">Tworzenie</h1>

      <div className="tworzenie-hub">
        {SECTIONS.map((section) => (
          <button
            key={section.key}
            type="button"
            className="tworzenie-tile"
            onClick={() => openSection(section.key)}
            disabled={section.comingSoon}
          >
            {section.comingSoon && <span className="badge-coming-soon badge-coming-soon--corner">Wkrótce</span>}
            <section.Icon className="tworzenie-tile-icon" />
            <span className="tworzenie-tile-label">{section.label}</span>
            <span className="tworzenie-tile-sub">{section.sublabel}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
