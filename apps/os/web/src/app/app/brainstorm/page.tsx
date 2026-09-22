import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function BrainstormPlaceholderPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-xs uppercase tracking-[0.16em] text-primary">Coming later</p>
      <h2 className="mt-2 font-heading text-3xl font-medium tracking-tight">Brainstorm</h2>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Placeholder</CardTitle>
          <CardDescription>
            Tables exist (`brainstorm_sessions`, `brainstorm_ideas`) so later work can land without
            another schema pass. The UI stays empty in M1.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm leading-6 text-muted-foreground">
          When this ships, operators will sketch campaigns here. No Zapier, no unsupervised spend,
          and no live platform writes from this surface.
        </CardContent>
      </Card>
    </div>
  );
}
