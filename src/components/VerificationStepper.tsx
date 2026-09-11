export function VerificationStepper({
  step1Done,
  step2Done,
}: {
  step1Done: boolean;
  step2Done: boolean;
}) {
  const step = !step1Done ? 1 : !step2Done ? 2 : 3;
  return (
    <ol className="flex items-center gap-2 text-xs" aria-label="Verification progress">
      <li aria-current={step === 1 ? "step" : undefined}>
        <span className={step >= 1 ? "font-semibold" : "text-muted-foreground"}>
          1 Customer {step1Done ? "✓" : ""}
        </span>
        {step1Done && <span className="sr-only">Complete</span>}
      </li>
      <span aria-hidden>→</span>
      <li aria-current={step === 2 ? "step" : undefined}>
        <span className={step >= 2 && step1Done ? "font-semibold" : "text-muted-foreground"}>
          2 Model/Serial {step2Done ? "✓" : ""}
        </span>
        {step2Done && <span className="sr-only">Complete</span>}
      </li>
      <span aria-hidden>→</span>
      <li aria-current={step === 3 ? "step" : undefined}>
        <span className={step === 3 ? "font-semibold" : "text-muted-foreground"}>3 Work</span>
      </li>
    </ol>
  );
}
