import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MailCheckIcon } from "lucide-react";
import { m } from "#/paraglide/messages";
import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "#/components/ui/dialog";
import { getSimulatedEmails } from "#/server/email-preview.functions";

const POLL_INTERVAL_MS = 3000;
const URL_PATTERN = /(https?:\/\/[^\s]+)/g;

/** Email bodies are plain text; turn their URLs (verify/reset/budget links)
 * into real links so they can be followed straight from the popup. */
function EmailBody({ text }: { text: string }): React.JSX.Element {
  return (
    <>
      {text.split(URL_PATTERN).map((part, index) =>
        index % 2 === 1 ? (
          <a
            key={index}
            href={part}
            className="break-all text-primary underline underline-offset-2"
          >
            {part}
          </a>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

interface QueuedEmail {
  id: number;
  to: string;
  subject: string;
  text: string;
}

/**
 * Local development delivers email to the server console. This polls for
 * those simulated emails and pops each one up as an alert, so the developer
 * sees the email the moment the app "sends" it. Renders nothing (and stops
 * polling) when a real email provider is configured.
 */
export function SimulatedEmailNotifier(): React.JSX.Element | null {
  const getSimulatedEmailsFn = useServerFn(getSimulatedEmails);
  const [cursor, setCursor] = useState<number | null>(null);
  const [queue, setQueue] = useState<QueuedEmail[]>([]);

  const { data } = useQuery({
    queryKey: ["simulated-emails", cursor],
    queryFn: () => getSimulatedEmailsFn({ data: { afterId: cursor } }),
    refetchInterval: (query) =>
      query.state.data?.enabled === false ? false : POLL_INTERVAL_MS,
  });

  useEffect(() => {
    if (!data?.enabled) return;
    if (data.emails.length > 0) {
      setQueue((previous) => [
        ...previous,
        ...data.emails.filter((email) => !previous.some((queued) => queued.id === email.id)),
      ]);
    }
    if (cursor === null || data.latestId > cursor) setCursor(data.latestId);
  }, [data, cursor]);

  const current = queue[0];
  if (!current) return null;

  const dismiss = (): void => setQueue((previous) => previous.slice(1));

  return (
    <Dialog open onOpenChange={(open) => !open && dismiss()}>
      <DialogContent className="sm:max-w-lg text-center">
        <div className="mx-auto mb-2 flex size-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 ring-8 ring-emerald-50 animate-in zoom-in-50 duration-300 dark:bg-emerald-950 dark:text-emerald-400 dark:ring-emerald-950/40">
          <MailCheckIcon className="size-8" aria-hidden="true" />
        </div>
        <DialogTitle className="text-xl font-semibold">{m.email_preview_title()}</DialogTitle>
        <DialogDescription className="text-xs text-muted-foreground">
          {m.email_preview_simulated()}
        </DialogDescription>
        <dl className="mt-3 space-y-1 text-left text-sm">
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 text-muted-foreground">{m.email_preview_to()}</dt>
            <dd className="break-all">{current.to}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 text-muted-foreground">{m.email_preview_subject()}</dt>
            <dd className="font-medium">{current.subject}</dd>
          </div>
        </dl>
        <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-line/50 bg-muted/40 p-3 text-left font-sans text-sm">
          <EmailBody text={current.text} />
        </pre>
        {queue.length > 1 && (
          <p className="text-xs text-muted-foreground">
            {m.email_preview_more({ count: String(queue.length - 1) })}
          </p>
        )}
        <Button className="mx-auto mt-2 min-w-28" onClick={dismiss} autoFocus>
          {m.email_preview_ok()}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
