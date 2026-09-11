export function VerificationStepper({
  step1Done,
  step2Done,
}: {
  step1Done: boolean;
  step2Done: boolean;
}) {
  const step = !step1Done ? 1 : !step2Done ? 2 : 3;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={step >= 1 ? "font-semibold" : "text-muted-foreground"}>
        1 Customer {step1Done ? "✓" : ""}
      </span>
      <span aria-hidden>→</span>
      <span className={step >= 2 && step1Done ? "font-semibold" : "text-muted-foreground"}>
        2 Model/Serial {step2Done ? "✓" : ""}
      </span>
      <span aria-hidden>→</span>
      <span className={step === 3 ? "font-semibold" : "text-muted-foreground"}>3 Work</span>
    </div>
  );
}
