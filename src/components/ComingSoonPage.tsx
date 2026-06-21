import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Props = {
  title: string;
  category: string;
  description?: string;
};

export function ComingSoonPage({ title, category, description }: Props) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <Badge variant="secondary">Category: {category}</Badge>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Coming soon</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm space-y-2">
          <p>
            {description ??
              "This module will be enabled shortly. Records created here will be tagged with the category above so they can be filtered, searched, and reported separately."}
          </p>
          <p>
            Document category/type: <span className="font-medium text-foreground">{category}</span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}