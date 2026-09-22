import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function LoadingGrid({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {Array.from({ length: count }, (_, key) => (
        <Card key={key} className="h-44 animate-pulse bg-muted/40" aria-hidden />
      ))}
    </div>
  );
}

export function LoadingLines({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-col gap-3" role="status" aria-live="polite">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="h-24 animate-pulse rounded-xl bg-muted/40" />
      <div className="h-24 animate-pulse rounded-xl bg-muted/40" />
    </div>
  );
}

export function ErrorCard({
  title,
  message,
  children,
}: {
  title: string;
  message: string;
  children?: ReactNode;
}) {
  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
      {children ? <CardContent>{children}</CardContent> : null}
    </Card>
  );
}

export function EmptyCard({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}

export function NoticeBanner({
  tone = "info",
  children,
}: {
  tone?: "info" | "error";
  children: ReactNode;
}) {
  return (
    <p
      className={
        tone === "error"
          ? "rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          : "rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm"
      }
    >
      {children}
    </p>
  );
}
