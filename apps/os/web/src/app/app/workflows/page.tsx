import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function WorkflowsPlaceholderPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-xs uppercase tracking-[0.16em] text-primary">Coming later</p>
      <h2 className="mt-2 font-heading text-3xl font-medium tracking-tight">Workflows</h2>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Placeholder</CardTitle>
          <CardDescription>
            Stub tables `workflows` and `workflow_runs` are in the M1 schema. Workflow builder v0
            (M8) will target Inngest as the native automation engine — no Zapier.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm leading-6 text-muted-foreground">
          Apply jobs enqueue as Inngest events and only run after an explicit authorization. The
          workspace kill switch defaults to on. No Tavily in the MVP.
        </CardContent>
      </Card>
    </div>
  );
}
