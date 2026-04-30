export type DismissibleNotificationTone = "info" | "warning";

type DismissibleNotificationProps = {
  detail?: string | null;
  onDismiss: () => void;
  title: string;
  tone?: DismissibleNotificationTone;
};

function NotificationCloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m7 7 10 10M17 7 7 17" />
    </svg>
  );
}

export default function DismissibleNotification({
  detail,
  onDismiss,
  title,
  tone = "info",
}: DismissibleNotificationProps) {
  return (
    <section
      aria-label={title}
      className={`dismissible-notification dismissible-notification-${tone}`}
    >
      <div className="dismissible-notification-copy">
        <p className="dismissible-notification-title">{title}</p>
        {detail ? (
          <p className="dismissible-notification-detail">{detail}</p>
        ) : null}
      </div>
      <button
        aria-label="Dismiss notification"
        className="secondary-action compact-action dismissible-notification-dismiss"
        title="Dismiss"
        type="button"
        onClick={onDismiss}
      >
        <NotificationCloseIcon />
      </button>
    </section>
  );
}
