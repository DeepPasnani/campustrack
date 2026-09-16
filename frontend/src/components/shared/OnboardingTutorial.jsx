import { useState } from 'react';
import { useStore } from '../../store';
import { Btn, Modal } from './UI';

/* ═══════════════════════════════════════════════════════════
 * CampusTrack — Student Onboarding Tutorial
 *
 * A short, dismissible walkthrough shown once to first-time
 * students. Reads/writes preferences.onboardingCompleted via
 * the shared store so it never shows again after completion.
 * ═══════════════════════════════════════════════════════════ */

const STEPS = [
  {
    title: 'Welcome to CampusTrack',
    body: 'This is your placement dashboard. Track upcoming tests, review your scores, and see where you stand on the leaderboard — all in one place.',
  },
  {
    title: 'Take a test',
    body: 'Open My Tests to start an aptitude or coding assessment. Your answers auto-save as you go, and you can flag questions to revisit before submitting.',
  },
  {
    title: 'Stay sharp',
    body: 'Keep an eye on your weak topics and practice consistently to climb the leaderboard.',
  },
];

export default function OnboardingTutorial() {
  const { preferences, completeOnboarding } = useStore();
  const [step, setStep] = useState(0);

  const isOpen = !preferences?.onboardingCompleted;
  const isLastStep = step === STEPS.length - 1;
  const current = STEPS[step];

  const handleClose = () => completeOnboarding();
  const handleNext = () => (isLastStep ? completeOnboarding() : setStep((s) => s + 1));
  const handleBack = () => setStep((s) => Math.max(0, s - 1));

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={current.title}
      footer={
        <div className="flex items-center justify-between w-full">
          <div className="flex gap-1">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`w-1.5 h-1.5 rounded-full ${i === step ? 'bg-clarify' : 'bg-annotation/30'}`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {step > 0 && (
              <Btn variant="ghost" size="sm" onClick={handleBack}>Back</Btn>
            )}
            <Btn variant="primary" size="sm" onClick={handleNext}>
              {isLastStep ? 'Get started' : 'Next'}
            </Btn>
          </div>
        </div>
      }
    >
      <p className="text-sm text-ink">{current.body}</p>
    </Modal>
  );
}
