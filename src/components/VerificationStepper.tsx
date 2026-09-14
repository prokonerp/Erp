import { Check, ClipboardCheck, User, Wrench } from "lucide-react";

export function VerificationStepper({
  step1Done,
  step2Done,
  step3Done,
}: {
  step1Done: boolean;
  step2Done: boolean;
  step3Done?: boolean;
}) {
  const step3Resolved = step3Done ?? (step1Done && step2Done);
  const done = [step1Done, step2Done, step3Resolved];
  // Index of the first incomplete step; -1 when all steps are complete.
  const current = !step1Done ? 0 : !step2Done ? 1 : !step3Resolved ? 2 : -1;

  const steps = [
    { label: "Customer", Icon: User },
    { label: "Model/Serial", Icon: Wrench },
    { label: "Work", Icon: ClipboardCheck },
  ];

  return (
    <ol className="flex items-start" aria-label="Verification progress">
      {steps.map(({ label, Icon }, i) => {
        const isDone = done[i];
        const isCurrent = i === current;
        return (
          <li
            key={label}
            aria-current={isCurrent ? "step" : undefined}
            className="flex min-w-0 flex-1 flex-col items-center"
          >
            <span className="flex w-full items-center">
              <span
                aria-hidden
                className={`h-[2px] flex-1 transition-colors duration-200 ${
                  i === 0 ? "bg-transparent" : done[i - 1] ? "bg-primary" : "bg-border"
                }`}
              />
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors duration-200 ${
                  isDone
                    ? "bg-primary text-primary-foreground"
                    : isCurrent
                      ? "border-2 border-primary bg-transparent text-primary"
                      : "border border-border bg-transparent text-muted-foreground"
                }`}
              >
                {isDone ? (
                  <Check className="size-3.5" aria-hidden />
                ) : (
                  <span aria-hidden>{i + 1}</span>
                )}
              </span>
              <span
                aria-hidden
                className={`h-[2px] flex-1 transition-colors duration-200 ${
                  i === steps.length - 1 ? "bg-transparent" : isDone ? "bg-primary" : "bg-border"
                }`}
              />
            </span>
            <span
              className={`mt-1.5 flex items-center gap-1 text-xs font-medium transition-colors duration-200 ${
                isDone || isCurrent ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              <Icon className="size-3.5" aria-hidden />
              {label}
            </span>
            {isDone && <span className="sr-only">(completed)</span>}
          </li>
        );
      })}
    </ol>
  );
}
