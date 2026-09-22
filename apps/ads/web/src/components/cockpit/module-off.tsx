import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function ModuleOff({
  title,
  help,
}: {
  title: string;
  help: string;
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Ads</p>
      <h2 className="mt-2 font-heading text-3xl font-medium tracking-tight">{title}</h2>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>This module is off</CardTitle>
          <CardDescription>{help}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm leading-6 text-muted-foreground">
          <p>Turn it on in Settings → Modules if you need it.</p>
          <p className="mt-4">
            <Link href="/app/settings" className="text-foreground underline">
              Open Modules
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
