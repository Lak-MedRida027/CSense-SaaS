import { useState } from 'react';
import { useAppState } from './AppProvider';
import { HomeContainer } from './containers/HomeContainer';
import { QuizContainer, targetFromSession, type QuizTarget } from './containers/QuizContainer';
import type { SecureSessionView } from '../../../shared/ipcChannels';

interface Active {
  target: QuizTarget;
  resume: SecureSessionView | null;
}

/** The released workstation: training home, or a quiz flow (including crash-recovery resume). */
export function Workspace() {
  const { resume, lockdown, homeRequests } = useAppState();
  // A session main still holds after a renderer reload goes straight back to the quiz.
  const [active, setActive] = useState<Active | null>(() =>
    resume ? { target: targetFromSession(resume.session), resume } : null,
  );

  // A notification click asks for "home", but never pulls the user out of a running quiz.
  const [seenRequests, setSeenRequests] = useState(homeRequests);
  if (homeRequests !== seenRequests) {
    setSeenRequests(homeRequests);
    if (lockdown.state === 'inactive') setActive(null);
  }

  if (active) {
    return (
      <QuizContainer
        target={active.target}
        resume={active.resume}
        onDone={() => {
          setActive(null);
        }}
      />
    );
  }
  return (
    <HomeContainer
      onStart={(target) => {
        setActive({ target, resume: null });
      }}
    />
  );
}
