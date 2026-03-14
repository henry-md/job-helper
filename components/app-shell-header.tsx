import Link from "next/link";
import SignOutButton from "@/components/sign-out-button";

function getValidProfileImageSrc(value: string | null | undefined) {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    return null;
  }

  if (normalizedValue.startsWith("/")) {
    return normalizedValue;
  }

  try {
    const url = new URL(normalizedValue);
    return url.protocol === "http:" || url.protocol === "https:"
      ? normalizedValue
      : null;
  } catch {
    return null;
  }
}

function ProfileAvatar({
  imageSrc,
  name,
}: {
  imageSrc: string | null;
  name: string;
}) {
  if (imageSrc) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={name}
        className="h-11 w-11 rounded-full object-cover"
        src={imageSrc}
      />
    );
  }

  return (
    <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-zinc-900 text-zinc-300">
      <svg
        aria-hidden="true"
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
      >
        <path
          d="M16 19v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
        <circle cx="10" cy="7" r="4" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="M22 19v-1a4 4 0 0 0-3-3.87"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
        <path
          d="M16 3.13a4 4 0 0 1 0 7.75"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      </svg>
    </div>
  );
}

export default function AppShellHeader({
  applicationCount,
  companyCount,
  currentView,
  openAIReady,
  pageLabel,
  userImage,
  userName,
}: {
  applicationCount: number;
  companyCount: number;
  currentView: "application-window" | "stats";
  openAIReady: boolean;
  pageLabel: string;
  userImage: string | null | undefined;
  userName: string | null | undefined;
}) {
  const displayName = userName?.trim()?.split(" ")[0] || userName || "there";
  const profileImageSrc = getValidProfileImageSrc(userImage);

  return (
    <header className="glass-panel soft-ring flex min-h-[88px] flex-wrap items-center justify-between gap-4 rounded-[1.5rem] px-5 py-4">
      <div className="flex min-w-0 items-center gap-3">
        <ProfileAvatar
          imageSrc={profileImageSrc}
          name={userName ?? "Profile"}
        />
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">
            {pageLabel}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-50">
            {displayName}
          </h1>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <nav className="flex items-center gap-2">
          <Link
            className={`rounded-full px-3 py-1 text-xs uppercase tracking-[0.2em] transition ${
              currentView === "application-window"
                ? "border border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                : "border border-white/10 text-zinc-400 hover:border-white/20 hover:text-zinc-200"
            }`}
            href="/dashboard"
          >
            Application window
          </Link>
          <Link
            className={`rounded-full px-3 py-1 text-xs uppercase tracking-[0.2em] transition ${
              currentView === "stats"
                ? "border border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                : "border border-white/10 text-zinc-400 hover:border-white/20 hover:text-zinc-200"
            }`}
            href="/stats"
          >
            Stats
          </Link>
        </nav>
        <span className="rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-zinc-400">
          {applicationCount} apps
        </span>
        <span className="rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-zinc-400">
          {companyCount} companies
        </span>
        <span
          className={`rounded-full px-3 py-1 text-xs uppercase tracking-[0.2em] ${
            openAIReady
              ? "border border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
              : "border border-amber-400/25 bg-amber-400/10 text-amber-200"
          }`}
        >
          {openAIReady ? "Ready" : "Setup needed"}
        </span>
        <SignOutButton />
      </div>
    </header>
  );
}
