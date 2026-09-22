import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function WorkflowsPlaceholderPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Coming later</p>
      <h2 className="mt-2 font-heading text-3xl font-medium tracking-tight">Workflows</h2>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Not open yet</CardTitle>
          <CardDescription>
            Automations will live here. Nothing runs without an explicit go-ahead.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm leading-6 text-muted-foreground">
          Apply stays a separate step. Ads stay paused by default. No unsupervised spend.
        </CardContent>
      </Card>
    </div>
  );
}
