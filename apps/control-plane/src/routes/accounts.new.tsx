/* oxlint-disable eslint/func-style, eslint/no-use-before-define -- TanStack file routes export Route before their component declarations. */
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";

import { CheckIcon } from "../components/icons";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Button, buttonVariants } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { RadioGroup, RadioGroupItem } from "../components/ui/radio-group";
import { Separator } from "../components/ui/separator";
import { accountKeys, configQuery } from "../features/accounts/queries";
import { createAccount } from "../lib/api";
import type { AccountType, CreateAccountInput } from "../lib/api";

export const Route = createFileRoute("/accounts/new")({
  component: NewAccountPage,
  loader: ({ context }) => context.queryClient.ensureQueryData(configQuery),
});

function NewAccountPage() {
  const navigate = useNavigate();
  const { data: config } = useSuspenseQuery(configQuery);
  const [accountType, setAccountType] = useState<AccountType>("agent");
  const [name, setName] = useState("");
  const mutationClient = Route.useRouteContext().queryClient;
  const mutation = useMutation({
    mutationFn: createAccount,
    onSuccess: async (account) => {
      await mutationClient.invalidateQueries({ queryKey: accountKeys.all });
      await navigate({ params: { did: account.did }, to: "/accounts/$did" });
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input: CreateAccountInput = { accountType, name };
    mutation.mutate(input);
  };

  return (
    <main className="page narrow-page">
      <div className="breadcrumb">
        <Link to="/accounts">Accounts</Link>
        <span>/</span>
        <span>New account</span>
      </div>

      <div className="page-heading compact">
        <div>
          <span className="eyebrow">Provision identity</span>
          <h1>Create account</h1>
          <p>
            Register a standard PDS account with a Control Plane signed invite.
          </p>
        </div>
      </div>

      <form className="creation-layout" onSubmit={submit}>
        <Card className="form-panel gap-0">
          <div className="form-section">
            <div className="section-number">01</div>
            <div className="section-content">
              <h2>Account operator</h2>
              <p>Choose who controls this identity after provisioning.</p>
              <RadioGroup
                className="type-options"
                onValueChange={(value) => {
                  if (value === "human" || value === "agent") {
                    setAccountType(value);
                  }
                }}
                value={accountType}
              >
                <div
                  className={`type-option ${accountType === "human" ? "selected" : ""}`}
                >
                  <RadioGroupItem id="account-type-human" value="human" />
                  <label htmlFor="account-type-human">
                    <strong>Human</strong>
                    <small>Person-operated identity</small>
                  </label>
                </div>
                <div
                  className={`type-option ${accountType === "agent" ? "selected" : ""}`}
                >
                  <RadioGroupItem id="account-type-agent" value="agent" />
                  <label htmlFor="account-type-agent">
                    <strong>Agent</strong>
                    <small>System-operated identity</small>
                  </label>
                </div>
              </RadioGroup>
            </div>
          </div>

          <Separator className="form-divider" />

          <div className="form-section">
            <div className="section-number">02</div>
            <div className="section-content field-stack">
              <div>
                <h2>Identity details</h2>
                <p>The handle is permanently associated with the new DID.</p>
              </div>
              <label className="field">
                <span>Account name</span>
                <div className="handle-input">
                  <Input
                    autoCapitalize="none"
                    autoComplete="off"
                    className="rounded-none focus-visible:border-transparent focus-visible:ring-0"
                    maxLength={63}
                    minLength={2}
                    onChange={(event) =>
                      setName(event.target.value.toLowerCase())
                    }
                    pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])?"
                    placeholder="atlas"
                    required
                    spellCheck={false}
                    value={name}
                  />
                  <span>.{config.pdsHostname}</span>
                </div>
                <small>Lowercase letters, numbers, and interior hyphens.</small>
              </label>

              <Alert>
                <CheckIcon />
                <AlertTitle>Credentials will be generated</AlertTitle>
                <AlertDescription>
                  Password, session, and recovery key are encrypted before
                  storage.
                </AlertDescription>
              </Alert>
            </div>
          </div>
        </Card>

        <aside className="creation-summary">
          <Card className="summary-card gap-0 py-0">
            <span className="eyebrow">Provisioning flow</span>
            <ol>
              <li>
                <span>1</span> Generate PLC recovery key
              </li>
              <li>
                <span>2</span> Sign a PDS-bound invite
              </li>
              <li>
                <span>3</span> Call createAccount XRPC
              </li>
              <li>
                <span>4</span> Store managed credentials
              </li>
            </ol>
            <div className="summary-destination">
              <small>Destination PDS</small>
              <strong>{config.pdsOrigin}</strong>
            </div>
          </Card>

          {mutation.error ? (
            <Alert variant="destructive">
              <AlertTitle>Account was not created</AlertTitle>
              <AlertDescription>{mutation.error.message}</AlertDescription>
            </Alert>
          ) : null}

          <Button
            className="w-full"
            disabled={mutation.isPending}
            size="lg"
            type="submit"
          >
            {mutation.isPending ? "Creating account…" : "Create account"}
          </Button>
          <Link
            className={buttonVariants({
              className: "w-full",
              size: "lg",
              variant: "outline",
            })}
            to="/accounts"
          >
            Cancel
          </Link>
        </aside>
      </form>
    </main>
  );
}
