import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { login } from "#/server/auth.functions";
import { useHydrated } from "#/lib/use-hydrated";
import { m } from "#/paraglide/messages";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import LocaleSwitcher from "#/components/LocaleSwitcher";


export const Route = createFileRoute("/login")({
  beforeLoad: async ({ context }) => {
    if (context.user) {
      throw redirect({ to: "/dashboard" });
    }
    if (!context.hasUsers) {
      throw redirect({ to: "/setup" });
    }
  },
  component: LoginPage,
});

function LoginPage() {
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const hydrated = useHydrated();

  const doLogin = useServerFn(login);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    const formData = new FormData(e.currentTarget);
    const identifier = formData.get("identifier");
    const password = formData.get("password");
    if (typeof identifier !== "string" || typeof password !== "string") {
      setLoading(false);
      return;
    }

    try {
      const result = await doLogin({ data: { identifier, password } });
      if (result && "error" in result) {
        setMessage(result.error);
      }
    } catch {
      // redirect will happen automatically
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="island-shell rounded-xl p-8">
          <h1 className="text-2xl font-bold display-title mb-2">{m.sign_in()}</h1>
          <p className="text-muted-foreground mb-6">
            {m.enter_credentials()}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label
                htmlFor="identifier"
                className="mb-1"
              >
                {m.email_or_username_label()}
              </Label>
              <Input
                type="text"
                name="identifier"
                id="identifier"
                required
                maxLength={255}
                placeholder={m.email_or_username_label()}
              />
            </div>

            <div>
              <Label
                htmlFor="password"
                className="mb-1"
              >
                {m.password_label()}
              </Label>
              <Input
                type="password"
                name="password"
                id="password"
                required
                placeholder={m.password_label()}
              />
            </div>

            {message && (
              <div role="alert" className="text-destructive text-sm">
                {message}
              </div>
            )}

            <Button className="w-full"
              type="submit"
              disabled={loading || !hydrated}
            >
              {!hydrated ? m.loading() : loading ? m.signing_in() : m.sign_in()}
            </Button>
          </form>

          <div className="mt-4 text-center">
            <Link
              to="/forgot-password"
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              {m.forgot_password_link()}
            </Link>
          </div>

          <div className="mt-6 pt-4 border-t border-line/50">
            <p className="text-sm text-muted-foreground text-center">
              {m.dont_have_account()}{" "}
              <Link
                to="/setup"
                className="text-primary underline-offset-4 hover:underline"
              >
                {m.create_one()}
              </Link>
            </p>
          </div>

          <div className="mt-4 flex justify-center">
            <LocaleSwitcher id="login-locale" />
          </div>

          <nav className="mt-4 flex justify-center gap-4 text-xs text-muted-foreground">
            <Link to="/terms" className="hover:text-foreground">
              {m.legal_terms()}
            </Link>
            <Link to="/privacy" className="hover:text-foreground">
              {m.legal_privacy()}
            </Link>
            <Link to="/security" className="hover:text-foreground">
              {m.legal_security()}
            </Link>
          </nav>
        </div>
      </div>
    </div>
  );
}
