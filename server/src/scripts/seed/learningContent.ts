import type { z } from 'zod';
import {
  FINAL_TEST_QUESTIONS_PER_SESSION,
  QUIZ_QUESTIONS_PER_SESSION,
  type assessmentAuthoringSchema,
  type moduleAuthoringSchema,
} from '@csense/shared';

/**
 * Placeholder learning content for development and tests (Phase 3 seed). It is generic on purpose:
 * no client branding, reserved example domains only, and plain-text lesson bodies. The client's
 * real content replaces it through the Phase 7 admin console.
 *
 * Authoring rule for explanations: teach the concept without naming the correct option, because a
 * failed attempt shows the explanation before the correct option is revealed (ADR 0007).
 */
export type SeedModule = z.input<typeof moduleAuthoringSchema>;
export type SeedAssessment = z.input<typeof assessmentAuthoringSchema>;

interface Item {
  text: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
}

const q = (text: string, options: string[], correctAnswer: number, explanation: string): Item => ({
  text,
  options,
  correctAnswer,
  explanation,
});

const media = (n: number, ext: 'mp4' | 'vtt'): string =>
  `https://media.example.com/csense/placeholder/m${String(n)}.${ext}`;

const cues = (...lines: string[]): { startSeconds: number; text: string }[] =>
  lines.map((text, i) => ({ startSeconds: i * 25, text }));

const RAW_MODULES: SeedModule[] = [
  {
    order: 1,
    title: 'Welcome to CSense',
    description: 'What this programme is, how the modules work, and why every employee matters.',
    format: 'video',
    duration: 6,
    isPublished: true,
    content:
      "CSense is your organisation's security awareness programme. You will work through short modules in order. Each module ends with a quiz, and passing it opens the next module. When you have passed every module you take a final assessment.\n\nYou can retry a quiz as often as you need. Use the review after each attempt to understand what to improve. The security team uses the results to offer help where it is needed, not to catch people out.",
    videoUrl: media(1, 'mp4'),
    captionsUrl: media(1, 'vtt'),
    transcript: cues(
      'Welcome. This programme takes a few minutes per module.',
      'Modules unlock one after another, so you always know what to do next.',
      'Each module ends with a short quiz. You can retry if you do not pass.',
      'A final assessment closes the programme once every module is complete.',
      'Remember: security is a shared responsibility, and you are part of it.',
    ),
    keyTakeaways: [
      'Modules unlock in order after you pass each quiz.',
      'Quizzes can be retried and reviewed.',
      'Everyone shares responsibility for security.',
    ],
    exercises: [],
  },
  {
    order: 2,
    title: 'Passwords and authentication',
    description: 'Create strong credentials, avoid reuse, and respond safely to sign-in prompts.',
    format: 'interactive',
    duration: 12,
    isPublished: true,
    content:
      'A password protects more than your own data. Length matters more than complexity: a long passphrase of unrelated words is strong and easy to remember. Never reuse a password between accounts, because one breach then opens every account.\n\nTurn on multi-factor authentication wherever it is offered. If you receive a sign-in approval you did not start, deny it and report it: someone may know your password.\n\nComplete the exercises below, then take the quiz.',
    keyTakeaways: [
      'Long, unique passphrases beat short complex passwords.',
      'A password manager removes the need to reuse passwords.',
      'Deny and report sign-in prompts you did not start.',
    ],
    exercises: [
      {
        prompt: 'Which new password is the strongest choice for your work account?',
        options: ['Summer2024!', 'correct-lantern-orbit-velvet-maple', 'P@ssw0rd', 'qwerty123456'],
        correctAnswer: 1,
        explanation:
          'Length and unpredictability decide strength. Several unrelated words form a long secret that is hard to guess and still memorable.',
      },
      {
        prompt:
          'You use the same password for a shopping site and for work. The shop reports a data breach. What should you do?',
        options: [
          'Nothing, the breach only affects the shop',
          'Change only the shop password',
          'Change the work password now and use a unique one for every account',
          'Add a number to the end of both passwords',
        ],
        correctAnswer: 2,
        explanation:
          'Breached passwords are tried against other services within hours. Any account that shared the secret is at risk until it is replaced with something unique.',
      },
      {
        prompt:
          'Your phone shows a sign-in approval request, but you are not signing in anywhere. What do you do?',
        artifact: 'Approve sign-in?\nSecureLogin request from an unknown device\n[Approve]  [Deny]',
        options: [
          'Approve it so the prompts stop',
          'Deny it and report it to the security team',
          'Ignore the phone',
          'Approve it, then change the password',
        ],
        correctAnswer: 1,
        explanation:
          'An unexpected prompt means someone may already hold your password and is hoping you give in. Refusing it and alerting the security team stops them and starts an investigation.',
      },
      {
        prompt: 'What is the safest way to keep track of many unique passwords?',
        options: [
          'Write them in a note on your desktop',
          'Email them to yourself',
          'Use an approved password manager',
          'Use the same one with small changes',
        ],
        correctAnswer: 2,
        explanation:
          'A dedicated tool stores secrets encrypted and fills them in for you, so you can use a different long secret everywhere without memorising any of them.',
      },
    ],
  },
  {
    order: 3,
    title: 'Phishing',
    description: 'Recognise deceptive emails and messages, and know what to do with them.',
    format: 'video',
    duration: 12,
    isPublished: true,
    content:
      'Phishing messages imitate people and organisations you trust to make you click, open an attachment or hand over credentials. Look for pressure and urgency, a sender address that does not match the name, links whose real destination differs from their text, and requests that bypass normal process.\n\nIf in doubt, do not click. Report the message using the report button or tell the security team.',
    videoUrl: media(3, 'mp4'),
    captionsUrl: media(3, 'vtt'),
    transcript: cues(
      'Phishing is the most common way attackers get in.',
      'Check the sender address, not only the display name.',
      'Hover over links to see where they really lead.',
      'Be wary of urgency, threats and surprising rewards.',
      'When unsure, report the message instead of acting on it.',
      'Reporting early protects your colleagues too.',
    ),
    keyTakeaways: [
      'Urgency and pressure are warning signs.',
      'Check the real sender address and link destination.',
      'Report suspicious messages instead of acting on them.',
    ],
    exercises: [
      {
        prompt: 'Read this message. What is the clearest warning sign?',
        artifact:
          'From: IT Support <helpdesk@example.net>\nSubject: Your mailbox will be deleted today\n\nYour mailbox is full. Sign in within 2 hours at https://mail-verify.example.net/login or lose all your email.',
        options: [
          'It mentions a mailbox',
          'It threatens loss within hours and links to an unfamiliar sign-in page',
          'It was sent during working hours',
          'It has a subject line',
        ],
        correctAnswer: 1,
        explanation:
          'Real administrators rarely threaten deletion within hours. A tight deadline combined with a sign-in link is designed to stop you from thinking.',
      },
      {
        prompt:
          'You hover over a link that says "View your invoice" and see a different, unfamiliar address. What does that tell you?',
        options: [
          'The link is probably safe',
          'The text and the destination disagree, so treat it as suspicious',
          'Your mouse is faulty',
          'The invoice is attached',
        ],
        correctAnswer: 1,
        explanation:
          'Attackers choose friendly link text while the real destination is somewhere else. A mismatch between the two is a classic sign of deception.',
      },
    ],
  },
  {
    order: 4,
    title: 'Social engineering',
    description: 'Spot manipulation by phone, in person and online, and respond calmly.',
    format: 'interactive',
    duration: 10,
    isPublished: true,
    content:
      'Social engineering manipulates people rather than machines. Attackers pretend to be colleagues, suppliers or officials, create urgency, and ask for something small first. Verify who you are talking to through a channel you already trust, never one the caller supplies.\n\nPhysical tricks work too: following you through a secured door, or leaving a USB drive where you will find it.',
    keyTakeaways: [
      'Verify identity through a channel you already trust.',
      'Urgency and authority are pressure tactics.',
      'Never plug in unknown devices or hold doors for strangers.',
    ],
    exercises: [
      {
        prompt:
          'A caller says they are from the help desk and need your password to fix an urgent problem. What do you do?',
        options: [
          'Give it, they are from IT',
          'Refuse, end the call and report it',
          'Give half of it',
          'Ask them to email you the request',
        ],
        correctAnswer: 1,
        explanation:
          'Legitimate support never needs your password. Ending the call and reporting it protects you and warns the team about the attempt.',
      },
      {
        prompt:
          'Someone you do not recognise follows you to a secured door and says they forgot their badge. What is the best response?',
        options: [
          'Hold the door, it is polite',
          'Politely direct them to reception or security',
          'Let them in but watch them',
          'Ask for a business card',
        ],
        correctAnswer: 1,
        explanation:
          'Access control only works if everyone uses it. Sending visitors through the proper process is courteous and keeps the building safe.',
      },
      {
        prompt:
          'You find a USB drive labelled "Salary review" in the car park. What should you do?',
        options: [
          'Plug it in to find the owner',
          'Hand it to the security team without plugging it in',
          'Take it home to check it',
          'Throw it in the bin',
        ],
        correctAnswer: 1,
        explanation:
          'Curiosity is the bait. An unknown device can run malicious software the moment it connects, so only specialists should examine it.',
      },
      {
        prompt:
          'An email appearing to come from a senior executive asks you to buy gift cards urgently and keep it confidential. What is the best action?',
        options: [
          'Do it quickly to help',
          'Reply asking for details',
          'Verify by phoning them on a known number and report the email',
          'Forward it to a colleague',
        ],
        correctAnswer: 2,
        explanation:
          'Secrecy plus urgency plus an unusual payment request is a well-known fraud pattern. Checking through a separate trusted channel breaks the trick.',
      },
    ],
  },
  {
    order: 5,
    title: 'Safe browsing and downloads',
    description: 'Browse with care, check where files come from, and keep software trustworthy.',
    format: 'video',
    duration: 9,
    isPublished: true,
    content:
      'A padlock in the address bar means the connection is encrypted, not that the site is trustworthy. Check the domain name carefully, avoid pop-ups that urge you to install something, and download software only from approved sources.\n\nIf a browser warns you about a site or a file, take the warning seriously and ask for help instead of clicking through.',
    videoUrl: media(5, 'mp4'),
    captionsUrl: media(5, 'vtt'),
    transcript: cues(
      'Safe browsing starts with the address bar.',
      'A padlock shows encryption, not honesty.',
      'Install software only from approved sources.',
      'Treat browser warnings as a reason to stop and ask.',
    ),
    keyTakeaways: [
      'A padlock proves encryption, not trustworthiness.',
      'Download only from approved sources.',
      'Browser warnings deserve attention.',
    ],
    exercises: [
      {
        prompt:
          'A page shows a padlock but its address is a slightly misspelt version of a well-known brand. Is it safe to sign in?',
        options: [
          'Yes, the padlock means it is safe',
          'No, the misspelt domain is the warning sign',
          'Yes, if the page looks right',
          'Only on a phone',
        ],
        correctAnswer: 1,
        explanation:
          'Anyone can obtain a padlock for any domain, including look-alike ones. The spelling of the address is what tells you who really runs the page.',
      },
      {
        prompt:
          'A pop-up claims your computer is infected and offers a free tool to clean it. What should you do?',
        options: [
          'Install the tool',
          'Close the page and tell the security team',
          'Click Allow to see what happens',
          'Call the number shown',
        ],
        correctAnswer: 1,
        explanation:
          'Fake alerts exist to frighten you into installing malware or phoning a scammer. Closing the page and informing the team is the safe response.',
      },
    ],
  },
  {
    order: 6,
    title: 'Protecting devices and data',
    description:
      'Keep devices updated and locked, handle data carefully, and stay safe on public networks.',
    format: 'interactive',
    duration: 11,
    isPublished: true,
    content:
      'Lock your screen whenever you step away. Install updates promptly because they fix known weaknesses. Share data only with people who need it, using approved tools, and treat public Wi-Fi as untrusted.\n\nIf a device is lost or stolen, report it immediately so access can be removed before anyone can misuse it.',
    keyTakeaways: [
      'Lock your screen and install updates promptly.',
      'Share data only through approved tools with people who need it.',
      'Report lost or stolen devices at once.',
    ],
    exercises: [
      {
        prompt: 'You are leaving your desk for a few minutes. What should you do?',
        options: [
          'Nothing, it is only a few minutes',
          'Lock the screen',
          'Turn the brightness down',
          'Close your email only',
        ],
        correctAnswer: 1,
        explanation:
          'A few unattended minutes are enough for someone to read or copy information. Locking takes one keystroke and removes the opportunity.',
      },
      {
        prompt: 'An update prompt appears when you are busy. What is the best choice?',
        options: [
          'Postpone it indefinitely',
          'Install it at the earliest convenient moment',
          'Turn off updates',
          'Wait until the device breaks',
        ],
        correctAnswer: 1,
        explanation:
          'Updates repair weaknesses that attackers already know about. Delay leaves a known door open for longer than necessary.',
      },
      {
        prompt: 'You must work from a cafe. Which is the safest approach?',
        options: [
          'Join any open Wi-Fi network',
          'Use the approved VPN or your own mobile connection',
          'Disable the firewall for speed',
          'Share your screen with the person nearby',
        ],
        correctAnswer: 1,
        explanation:
          'Open networks can be watched or imitated. A protected tunnel or a personal connection keeps your traffic away from strangers.',
      },
      {
        prompt:
          'You need to send a file with personal customer data to a colleague. What is the right way?',
        options: [
          'Use your personal email',
          'Use the approved sharing tool and limit access',
          'Post it in a public channel',
          'Copy it to a personal USB drive',
        ],
        correctAnswer: 1,
        explanation:
          'Approved tools keep control, logging and access limits in place. Personal channels leave the organisation without any of those protections.',
      },
    ],
  },
  {
    order: 7,
    title: 'Reporting incidents',
    description: 'Know what to report, how quickly, and why speed matters more than certainty.',
    format: 'video',
    duration: 7,
    isPublished: true,
    content:
      'Report anything that looks wrong: suspicious messages, unexpected prompts, lost devices, mistakes such as sending data to the wrong person, or anything that makes you uneasy. You do not need to be certain, and you will not be blamed for a good-faith report.\n\nThe faster the security team hears, the more they can limit the damage. Tell them what you saw, when, and what you did, without deleting evidence.',
    videoUrl: media(7, 'mp4'),
    captionsUrl: media(7, 'vtt'),
    transcript: cues(
      'Reporting early limits the damage.',
      'You do not need to be sure that something is an incident.',
      'Say what you saw, when it happened and what you did.',
      'Keep the evidence: do not delete the message.',
      'Thank you for helping keep the organisation safe.',
    ),
    keyTakeaways: [
      'Report early, even if you are unsure.',
      'Describe what you saw, when, and what you did.',
      'Keep evidence rather than deleting it.',
    ],
    exercises: [
      {
        prompt:
          'You clicked a link in an email and then realised it looked suspicious. What should you do?',
        options: [
          'Say nothing and hope it was fine',
          'Report it to the security team straight away',
          'Delete the email and move on',
          'Wait to see if anything happens',
        ],
        correctAnswer: 1,
        explanation:
          'The first minutes are when containment is easiest. An honest, immediate report gives the team the best chance to help, and good-faith reports are welcome.',
      },
    ],
  },
];

/**
 * Five questions per module quiz, keyed by module order.
 *
 * Authoring rules enforced by the shared authoring check (seedLearning.test.ts):
 * - an explanation teaches the concept without repeating the distinctive words of the correct option;
 * - the correct option is not systematically the longest, so the options are written with similar
 *   length and a plausible distractor is often the longest;
 * - no item copies an exercise or another assessment.
 */
type RawAssessment = Omit<SeedAssessment, 'questionsPerSession'>;

const RAW_QUIZZES: Record<number, RawAssessment> = {
  1: {
    title: 'Welcome quiz',
    passingScore: 70,
    questions: [
      q(
        "Who is responsible for protecting your organisation's information?",
        [
          'Only the security team, because they run the monitoring tools',
          'Only the IT department, since they manage every computer and account',
          'Every employee, within the work they personally handle',
          'Only senior managers, who sign off the written policies',
        ],
        2,
        'Attackers pick whoever is easiest to reach, so a single team cannot cover every door. Protection works only when each person looks after what passes through their hands.',
      ),
      q(
        'How do the CSense modules become available to you?',
        [
          'All of them are open from your first day',
          'One after another, each opening when the previous quiz is passed',
          'On a fixed calendar date chosen for the whole company',
          'Whenever your line manager approves the next one by email',
        ],
        1,
        'A fixed order keeps the learning path clear and makes sure earlier topics are understood before later ones build on them.',
      ),
      q(
        'You do not reach the pass mark on a quiz. What happens next?',
        [
          'You are removed from the programme until the next intake begins',
          'You can look over your answers and take the quiz again',
          'You skip ahead, and the module is marked as complete anyway',
          'Your manager receives an immediate warning about the result',
        ],
        1,
        'The programme is about learning rather than punishment. A look at where points were lost shows what to revisit before another go.',
      ),
      q(
        'Which route do attackers most often use to get a first foothold in an organisation?',
        [
          'Breaking strong encryption by running huge numbers of guesses',
          'Physically carrying servers out of a secured data centre',
          'Persuading a person to act on a deceptive message',
          'Taking over office printers through a hidden maintenance port',
        ],
        2,
        'Tricking a person is cheaper and quicker than defeating well-built technology, which is why training concentrates on deception.',
      ),
      q(
        'You spot something unusual that could be a security problem. What is the most helpful move?',
        [
          'Wait quietly, because someone more senior will certainly have noticed it',
          'Let the security team know promptly, even if you are unsure',
          'Remove any trace of it so that nobody else gets worried',
          'Describe it in a public chat room to see if others agree',
        ],
        1,
        'Specialists can confirm or dismiss a doubt in minutes, whereas a missed real incident can cost far more than any number of harmless alarms.',
      ),
    ],
  },
  2: {
    title: 'Passwords and authentication quiz',
    passingScore: 70,
    questions: [
      q(
        'Which of these secrets would be hardest for a guessing tool to crack?',
        [
          'A short word with a few symbols added at the end',
          'Your date of birth written in an unusual order',
          'The name of your pet followed by the current year',
          'Several unrelated everyday words joined together',
        ],
        3,
        'Every extra character multiplies the work for an attacker, and patterns drawn from personal facts are the first things automated tools try.',
      ),
      q(
        'What is the danger in using one password for several different accounts?',
        [
          'It makes sign-in noticeably slower on busy networks',
          'A leak at one service can unlock every other service sharing it',
          'Most websites automatically lock accounts that do this',
          'It uses up more of the space reserved for stored credentials',
        ],
        1,
        'Criminals feed leaked login lists into countless unrelated websites within hours, so one careless site can expose any account that reuses the same secret.',
      ),
      q(
        'What does multi-factor authentication add to a password?',
        [
          'A second password of the same kind, typed straight after the first',
          'Proof of identity of a second, different kind',
          'Automatic renewal of the password every thirty days',
          'Permission to sign in from two devices at the same time',
        ],
        1,
        'Combining something you know with something you hold or are means a stolen secret by itself no longer opens the door.',
      ),
      q(
        'Your phone keeps showing sign-in approvals that you never started. What is the right reaction?',
        [
          'Approve just one so that the constant notifications finally stop for the day',
          'Deny them all and tell the security team what is happening',
          'Switch the phone off for the rest of the day and carry on',
          'Pass the code on to a colleague who offers to look at it',
        ],
        1,
        'Repeated prompts usually mean someone already holds your password and is hoping you give in out of annoyance, so people who can investigate need to know.',
      ),
      q(
        'With whom may you share your account password?',
        [
          'Your line manager, whenever they ask for it for a good reason',
          'Anyone calling from the help desk who knows your employee number',
          'Nobody at all, whatever their role or the urgency claimed',
          'A trusted colleague who is covering your leave for the week',
        ],
        2,
        'A credential exists to show that one particular person is acting. Handing it over breaks that link, and legitimate staff have other ways to help.',
      ),
    ],
  },
  3: {
    title: 'Phishing quiz',
    passingScore: 70,
    questions: [
      q(
        'Which feature of an email is a common sign of phishing?',
        [
          'A greeting that uses your first name, as colleagues do',
          'Strong pressure to act within minutes or else',
          'A signature block with a phone number at the bottom',
          'Being delivered on an ordinary working day',
        ],
        1,
        'Urgency is designed to stop careful thought. Genuine requests rarely depend on an instant answer under threat.',
      ),
      q(
        'How can you see where a link in a message will really take you?',
        [
          'Read the words displayed as the clickable text',
          'Rest the pointer on it and read the address that appears',
          'Click it once in a private window and watch the page',
          'Ask the sender, in a reply to the same message, whether it is safe',
        ],
        1,
        'Displayed text can claim anything. The true destination can be inspected before any click, which costs nothing.',
      ),
      q(
        'A familiar colleague sends an unexpected attachment with oddly worded text. What is the safest step?',
        [
          'Open it quickly to find out what it is about',
          'Forward it to the whole team so more people can check it',
          'Reply to the same message and ask whether it is genuine',
          'Check with them through another trusted route',
        ],
        3,
        'Accounts get taken over, so a known name proves little. A different route cannot be controlled by whoever holds the mailbox.',
      ),
      q(
        'You believe you have received a phishing message. What should you do with it?',
        [
          'Use the report button or tell the security team about it',
          'Answer the sender to warn them that you noticed',
          'Delete it silently and carry on with your morning',
          'Open the link on a spare device to see how bad it is',
        ],
        0,
        'Colleagues may hold the same message, and filters improve from examples, so passing it on protects far more than your own inbox.',
      ),
      q(
        'What distinguishes "spear phishing" from ordinary phishing?',
        [
          'It is sent in huge volumes to randomly chosen addresses',
          'It targets one person using researched details',
          'It spreads automatically from one computer to the next',
          'It is delivered only through advertising on social networks',
        ],
        1,
        'Attackers study their target first, so the message mentions real projects and names, which makes it far more believable than a mass mailing.',
      ),
    ],
  },
  4: {
    title: 'Social engineering quiz',
    passingScore: 70,
    questions: [
      q(
        'What do social engineering attacks take advantage of?',
        [
          'Programming mistakes in widely used software',
          'Ordinary human habits such as politeness and trust',
          'Weak mathematical choices made inside network encryption standards',
          'Old hardware that no longer receives updates',
        ],
        1,
        'The target is the person, using helpfulness, fear of trouble and respect for authority rather than any technical fault.',
      ),
      q(
        'A caller says they work for a supplier and pushes you for details. How do you respond?',
        [
          'Share what they ask for, since it helps the supplier',
          'Hand over a little at a time while judging how credible they sound',
          'Check who they are by calling a number you already hold',
          'Ask them to phone back from a number that is hidden',
        ],
        2,
        'Dialling a contact from your own records takes the conversation out of the caller’s hands and quickly shows who is genuine.',
      ),
      q(
        'Why do manipulators like to create a sense of urgency?',
        [
          'It leaves you less time to check',
          'It makes their message shorter and easier to type',
          'It is demanded by the rules of most large companies',
          'It speeds up delivery of the messages they send',
        ],
        0,
        'A person in a hurry skips the very checks that would expose the story.',
      ),
      q(
        'What is "tailgating" in a security context?',
        [
          'Driving too close behind another vehicle in the car park',
          'Sending a rapid series of messages to wear someone down',
          'Guessing the digits of a door code after watching a colleague',
          'Following an authorised person into a controlled area',
        ],
        3,
        'It relies on the awkwardness of challenging someone, which is why each person should use their own pass every time.',
      ),
      q(
        'You are told that a request must be kept secret from your manager. What does this most likely indicate?',
        [
          'An unusual but normal arrangement for sensitive projects',
          'A reward for being someone the sender particularly trusts',
          'A deliberate attempt to cut you off from anyone who could check',
          'A confidentiality rule that applies to all finance matters',
        ],
        2,
        'Isolation is a classic tactic, because a genuine request can stand up to a second opinion while a trick cannot.',
      ),
    ],
  },
  5: {
    title: 'Safe browsing and downloads quiz',
    passingScore: 70,
    questions: [
      q(
        'What does the padlock symbol beside a web address actually tell you?',
        [
          'The site belongs to a business that has been checked for honesty',
          'Data travelling between you and the site is encrypted',
          'The pages contain no harmful software of any kind',
          'Your organisation has approved the site for general use',
        ],
        1,
        'It describes how information moves, not who is on the other end, and fraudulent sites can show it too.',
      ),
      q(
        'Where should you get software that you need for work?',
        [
          'Any download site that has plenty of positive reviews',
          'The sources your organisation provides and maintains',
          'A link that a friendly stranger sent you in a message',
          'A file-sharing network where the program is offered for free',
        ],
        1,
        'Managed sources are checked and kept up to date, while unofficial copies are a favourite hiding place for malicious code.',
      ),
      q(
        'Your browser warns that the page you are opening is dangerous. What is the best choice?',
        [
          'Continue anyway, because you will be careful on the page',
          'Turn the warning feature off so it stops interrupting you',
          'Leave the page, and tell the security team if it was work-related',
          'Try the same address again in a second browser',
        ],
        2,
        'These warnings come from lists of known harmful places, and pressing on discards a protection that was working properly.',
      ),
      q(
        'Why is a web address with a slightly altered spelling worrying?',
        [
          'It can be a look-alike page built to be mistaken for the real one',
          'It usually means the site has been online for many years',
          'It will normally load more slowly than other pages',
          'It is probably blocked by national legislation',
        ],
        0,
        'Imitation sites depend on the small difference going unnoticed, so you trust a page that is not what it appears to be.',
      ),
      q(
        'An unrequested file arrives from someone you have never met. What is the safest approach?',
        [
          'Open it, since it might contain something useful for your job',
          'Leave it unopened and delete it or report it',
          'Run your own quick scan and open it if nothing is found',
          'Send it to a friend so they can try it first',
        ],
        1,
        'Unsolicited files are a main delivery route for malware, and a quick personal scan cannot prove anything is clean.',
      ),
    ],
  },
  6: {
    title: 'Protecting devices and data quiz',
    passingScore: 70,
    questions: [
      q(
        'Why should you lock the screen each time you step away from your desk?',
        [
          'It saves battery power while the device sits idle',
          'It keeps other people from using a session that is signed in as you',
          'It closes every program that you had left open',
          'It makes the device start up faster afterwards',
        ],
        1,
        'Anything done on an unlocked machine is attributed to its owner, and whatever is on the display can be read by passers-by.',
      ),
      q(
        'What is the main benefit of installing software updates promptly?',
        [
          'They give the software a fresh appearance and new icons',
          'They repair weaknesses that attackers already know how to exploit',
          'They free some space on the disk of the device',
          'They are demanded by the companies that make the hardware',
        ],
        1,
        'Once a flaw becomes public, attackers race to use it, so every day of delay leaves a known gap open.',
      ),
      q(
        'Which arrangement keeps your laptop traffic private while you work from an airport lounge?',
        [
          'Join the first free network that shows up on your device',
          'Connect to any network whose name matches the venue',
          'Turn off the security software so the connection runs faster',
          'Use the approved secure tunnel or your own phone connection',
        ],
        3,
        'Shared networks can be watched or imitated, whereas a protected channel stops strangers from reading your traffic.',
      ),
      q(
        'A company laptop has just been stolen from your car. What is your first step?',
        [
          'Report it to the security team immediately',
          'Wait a few days in case it turns up somewhere',
          'Order a replacement before telling anyone about it',
          'Update the password of your personal social media accounts',
        ],
        0,
        'Quick notice lets access be cut off and data be erased from afar before anyone can reach what is stored.',
      ),
      q(
        'Which way of sending a file with confidential content is acceptable?',
        [
          'Attach it to a message from your own private email account',
          'Create a public link and paste it into a team channel',
          'Use the approved sharing tool and limit who can open it',
          'Copy it to a personal cloud folder and give out the password',
        ],
        2,
        'Managed tools keep control and a record of who saw what, which private services cannot offer the organisation.',
      ),
    ],
  },
  7: {
    title: 'Reporting incidents quiz',
    passingScore: 70,
    questions: [
      q(
        'When is the right moment to report a possible security incident?',
        [
          'Only after you have collected firm proof that something happened',
          'As soon as you suspect that something is wrong',
          'At the end of the month together with other administrative notes',
          'Once damage has been noticed by other departments',
        ],
        1,
        'Certainty usually arrives too late. Investigators can confirm details afterwards, but nobody can give back lost time.',
      ),
      q(
        'You mailed a confidential document to the wrong recipient. What do you do?',
        [
          'Hope the recipient ignores it and say nothing',
          'Tell the security team straight away so the exposure can be limited',
          'Write to the recipient asking them to delete it and leave it there',
          'Wait for a reply before deciding whether it matters',
        ],
        1,
        'Quick notice lets responders contact the recipient and contain the damage, and honest slips that are flagged early are dealt with constructively.',
      ),
      q(
        'Which details make a report most useful to the security team?',
        [
          'Your view on which colleague is probably to blame',
          'What you saw, when it happened and what you did next',
          'Only the day of the week on which it happened',
          'A promise that you will investigate it yourself first',
        ],
        1,
        'A clear timeline of facts lets responders act quickly without having to track you down for missing information.',
      ),
      q(
        'Why should you keep a suspicious email instead of deleting it before you report it?',
        [
          'Deleted messages stay forever in a hidden archive anyway',
          'Company policy forbids the removal of any message',
          'It may be needed as evidence of how the attack was built',
          'A cleaner mailbox is ranked lower in the monthly statistics',
        ],
        2,
        'Headers and content show how the attack works, which helps responders find and stop other copies elsewhere.',
      ),
      q(
        'What happens to someone who reports in good faith something that turns out to be harmless?',
        [
          'They are recorded as having caused an unnecessary disruption',
          'They are asked to stop reporting until they have more experience',
          'They are encouraged, because reports made honestly are welcome',
          'Their manager decides whether any action should follow',
        ],
        2,
        'A culture that values reporting finds real problems sooner, so the occasional false alarm is a small price to pay.',
      ),
    ],
  },
};

/** Fifteen new questions spanning all seven modules (none copies an exercise or a module quiz item). */
const RAW_FINAL_TEST: RawAssessment = {
  title: 'Final assessment',
  passingScore: 70,
  questions: [
    q(
      'A new colleague wonders why people with no technical role must take this training. Which answer is most accurate?',
      [
        'Anyone holding an account or data can be targeted',
        'Only staff who use specialised software are ever contacted by attackers',
        'The training exists mainly to satisfy an annual paperwork requirement',
        'Non-technical staff are exempt once their manager signs a form',
      ],
      0,
      'Criminals look for the easiest entry, and that is often a busy person rather than a server, so the audience for awareness is the whole workforce.',
    ),
    q(
      'A shared project tool offers no second sign-in step. How should its login be set up?',
      [
        'A long phrase used nowhere else, stored in the approved manager',
        'The password of your email account, so there is only one to recall',
        'A simple word that every team member can remember easily',
        'A variation of last year’s password with a new number at the end',
      ],
      0,
      'Without a second step, the secret itself must carry all the strength, and separation from other services limits the fallout of any leak elsewhere.',
    ),
    q(
      'You approved a sign-in request by mistake a minute ago. What should you do immediately afterwards?',
      [
        'Wait to see whether anything unusual happens during the day',
        'Report it and change the password straight away',
        'Close the app on your phone so the request disappears',
        'Ask a colleague whether they have ever done the same thing',
      ],
      1,
      'Acting early can cut off an intruder before they settle in, and the specialists can look for signs that the approval was used.',
    ),
    q(
      'A delivery notice with a tracking link reaches you, but you are not expecting any parcel. How should you treat it?',
      [
        'Follow the link, since tracking pages are normally harmless',
        'Reply with a question about the sender’s company',
        'Skip the link and check with the courier directly',
        'Forward the notice to friends who may be waiting for something',
      ],
      2,
      'Unexpected notices borrow trusted brand names to lure clicks; going to the service yourself leaves the sender’s link out of the picture.',
    ),
    q(
      'Which clue about a message’s origin is the most dependable sign that it is not genuine?',
      [
        'The sender domain does not match the claimed organisation',
        'The message contains a logo that looks slightly blurry',
        'The text has been written in a friendly, informal style',
        'It arrived late in the evening instead of during the day',
      ],
      0,
      'Logos, tone and timing are easy to copy or to vary, whereas the technical origin of a message is much harder to disguise convincingly.',
    ),
    q(
      'Someone phones saying they are an auditor and asks for a list of staff names and their roles. What is the sensible reply?',
      [
        'Read the list out, because auditors have a right to see everything',
        'Offer to send it later by email without checking who they are',
        'Give only the names but keep the job titles to yourself',
        'Note their details and verify the request officially',
      ],
      3,
      'Lists of staff are valuable preparation for later attacks, and a genuine review will tolerate a short delay while the caller is verified by official means.',
    ),
    q(
      'A stranger in a high-visibility vest says they are here to fix the air conditioning and asks the way to the server room. What do you do?',
      [
        'Walk them there yourself, as they are plainly in a hurry',
        'Describe the route and return to your desk',
        'Ask reception to confirm the visit first',
        'Hold the doors open so that they can find it unaided',
      ],
      2,
      'Uniforms and confidence are cheap props, so the people who schedule such work are the only ones able to vouch for a caller.',
    ),
    q(
      'A search result promises a free copy of an expensive program. Why is downloading it risky?',
      [
        'Free copies are normally far slower than paid versions',
        'Cracked installers often hide malicious code',
        'The licence terms may be written in an unfamiliar language',
        'It could fill the disk with more data than you expected',
      ],
      1,
      'People who give away costly software for nothing usually want something in return, such as a foothold on your machine.',
    ),
    q(
      'Your browser stops a download and says the file is rarely fetched by other users. What is the best response?',
      [
        'Keep the file anyway, since the warning may be mistaken',
        'Disable the protection feature so that downloads are not blocked again',
        'Move the file to another folder and open it from there',
        'Discard it and request an approved copy',
      ],
      3,
      'Rarity is itself a signal, because common legitimate files are known to the protection service while fresh malware is not.',
    ),
    q(
      'Your work phone must be handed in for repair. What should happen before it leaves your hands?',
      [
        'Nothing special, as repair shops are generally trustworthy',
        'The security team should clear or secure the stored work data first',
        'You should hide the phone’s lock code on a sticky note inside the box',
        'The contacts should be copied to your personal device for safekeeping',
      ],
      1,
      'A device out of your control may be examined by strangers, so anything sensitive should be removed or locked down beforehand.',
    ),
    q(
      'Why can a privacy screen on a laptop help while you are travelling by train?',
      [
        'It makes the picture clearer in bright sunlight',
        'It prevents people sitting beside you from reading what is shown',
        'It stops the processor from becoming too warm',
        'It blocks wireless signals from reaching the machine',
      ],
      1,
      'Casual glances over your shoulder are an easy way to learn confidential details, and narrowing the viewing angle takes that chance away.',
    ),
    q(
      'Which of these shows information being handled in line with good practice?',
      [
        'A customer file placed on a shared drive that anyone in the company can open',
        'A contract discussed in a lift while visitors are present',
        'A printed report left beside the shared printer until the next morning',
        'A salary spreadsheet sent only to the two managers who need it',
      ],
      3,
      'Information should travel no wider than the task requires, and through places where access is limited and recorded.',
    ),
    q(
      'You reported a suspicious page and then realised you had typed your password into it. What should you add to the report?',
      [
        'Nothing more, because the first report already covers everything',
        'That the credentials were entered, so the account can be secured at once',
        'A request to keep the matter from your manager for now',
        'A note saying you will change the password if you remember to later',
      ],
      1,
      'This detail changes the response from watching a threat to protecting a live account, so leaving it out wastes valuable time.',
    ),
    q(
      'Why do responders ask you not to wipe or reinstall a device you think was compromised?',
      [
        'Reinstalling would use up the licence allowance for the operating system',
        'Wiping a device is only allowed during working hours',
        'Traces left on it show what happened and how far it spread',
        'The vendor’s warranty is cancelled by any software change',
      ],
      2,
      'The state of the machine is the evidence, and cleaning it removes the clues needed to find the entry point and other victims.',
    ),
    q(
      'How does the programme treat a mistake that is reported promptly and honestly?',
      [
        'It is noted against the person for the annual review',
        'It is treated as an opportunity to learn, and quick reporting is valued',
        'It is ignored unless the same slip occurs again',
        'It is shared by name with the rest of the department',
      ],
      1,
      'People hide errors when they expect blame, and hidden errors are the ones that grow, so the culture rewards speaking up.',
    ),
  ],
};

/**
 * Second half of each pool (P3-M1). A quiz serves 5 questions from a pool of 10 and the final test
 * serves 15 from a pool of 30, so a retry mostly meets questions the employee has not seen.
 */
const EXTRA_QUIZ_QUESTIONS: Record<number, Item[]> = {
  1: [
    q(
      'A colleague claims that security only matters to very large companies. What is the best reply?',
      [
        'Organisations of every size are targeted, because attackers choose weak spots rather than famous names',
        'That is right, because small businesses hold nothing that a criminal could ever want to steal or sell on',
        'That holds only when a company has no link to the internet',
        'It depends mostly on the industry and hardly at all on what people do',
      ],
      0,
      'Criminals scan widely and take whatever is easiest. Size matters little to them, but preparation matters a great deal.',
    ),
    q(
      'Why does CSense keep a record of your quiz attempts?',
      [
        'To let the security team see where extra support would be useful',
        'To publish a league table that lists the weakest performers',
        'To decide who should be dismissed from the company after a poor result',
        'To count how often each person opens the application',
      ],
      0,
      'Results guide coaching and content rather than blame. Patterns across many people show which topics need more attention.',
    ),
    q(
      'Which habit best shows that you share responsibility for security?',
      [
        'Mentioning odd activity to the right people before you are certain',
        'Leaving all decisions about safety to whoever looks after the computers',
        'Waiting for a formal request from the security team before taking any care',
        'Assuming that automatic filters will catch everything that matters',
      ],
      0,
      'Tools reduce risk, yet people notice context that software misses, and an early word multiplies the value of both.',
    ),
    q(
      'What is the purpose of the final assessment?',
      [
        'To confirm that the whole programme has been understood',
        'To replace the module quizzes with a single longer test',
        'To unlock the first module for people who skipped it',
        'To collect personal opinions about the course content',
      ],
      0,
      'A closing check across every topic shows whether the pieces fit together, beyond what one short quiz can show.',
    ),
    q(
      'You are short of time. How should you approach a module?',
      [
        'Work through the lesson and exercises properly, then take the quiz when ready',
        'Skip the lesson entirely and guess at the quiz again and again until the answers are shown',
        'Ask a colleague to take the quiz while you watch the video',
        'Start the video, leave it running and do something else meanwhile',
      ],
      0,
      'Content and practice prepare the ground; the test then checks what stuck, and shortcuts only postpone the gap.',
    ),
  ],
  2: [
    q(
      'A website insists that your new password contains a symbol. What is the best way to meet that rule?',
      [
        'Add a symbol to an existing favourite and keep the rest the same',
        'Pick a long phrase of unrelated words and place a symbol between two of them',
        'Use the required symbol on its own, followed by the same number that you use everywhere else',
        'Choose a short combination of letters and symbols that is easy to type',
      ],
      1,
      'Length does most of the work, and a rule about symbols is satisfied just as well by a phrase as by a clumsy short string.',
    ),
    q(
      'What should you do when a service tells you that your login details appeared in a public leak?',
      [
        'Change that secret at once, and change it anywhere else it was used',
        'Ignore the notice, since leaks involve millions of people and yours is unlikely to be used',
        'Wait for the provider to reset the secret for you',
        'Add one digit to the end and carry on as before',
      ],
      0,
      'Leaked lists are tried against other services within hours, so speed and thoroughness decide whether the damage spreads.',
    ),
    q(
      'Which second factor is generally the hardest for a remote attacker to obtain?',
      [
        'A code that arrives as a text message to a number that could be swapped',
        'A physical security key that must be plugged in or tapped',
        'A secret question whose answer appears on social media',
        'A password hint stored on the same device',
      ],
      1,
      'Something that must be held in the hand cannot be copied from a distance, unlike information that lives in networks or profiles.',
    ),
    q(
      'You are asked to enter your work password on a page reached from an unexpected message. What is the right choice?',
      [
        'Enter it, since the page shows your company logo',
        'Enter it only if the page loads quickly and looks tidy',
        'Close the page and open the sign-in address yourself from a bookmark',
        'Send the password to the helpdesk by email so that they can test the page on your behalf',
      ],
      2,
      'Anything can be made to look familiar, but a destination you reach on your own initiative cannot be steered by the sender.',
    ),
    q(
      'Why is it risky to save work passwords in your personal web browser profile?',
      [
        'Anyone who gains access to that personal profile also gains your work accounts',
        'Browsers erase saved passwords after one week, so nothing sensitive can stay there for long',
        'Work accounts do not accept stored passwords',
        'It slows down the pages you visit most',
      ],
      0,
      'Personal profiles sync across many devices and fall outside company controls, so a weak link there reaches everything stored inside.',
    ),
  ],
  3: [
    q(
      'An email from your bank asks you to confirm your details through a button. What is the safest way to check it?',
      [
        'Press the button in the message and judge from the look of the page that opens whether it is real',
        'Open your usual banking app or site yourself and look for a notice there',
        'Reply to ask whether the message is real',
        'Forward it to a friend and ask what they think',
      ],
      1,
      'Genuine news from a bank also shows up inside the service you already use, so checking in that place leaves the message’s own link untouched.',
    ),
    q(
      'Which attachment type deserves the most suspicion when it arrives unexpectedly?',
      [
        'A plain text file with no formatting, pictures or active content of any sort',
        'A compressed archive or a document asking you to enable macros',
        'A picture saved in a common format',
        'A calendar invitation from your own team',
      ],
      1,
      'Files that ask for extra permissions or hide their content inside a bundle are designed to run code the moment they are opened.',
    ),
    q(
      'You receive a message that appears to continue an earlier conversation, but the reply address is slightly different. What does that suggest?',
      [
        'The sender has simply changed to a new email provider and forgotten to tell anyone',
        'Someone may be imitating the person or has taken over a related account',
        'Your mail program has reformatted the address',
        'The message is automatically more trustworthy',
      ],
      1,
      'Attackers slot into real threads to borrow trust, and a small change in the address is often the only trace they leave.',
    ),
    q(
      'What is a sensible reaction to a text message that claims your parcel is held and asks for a small fee?',
      [
        'Pay the fee at once, because it is so small that it is not worth the time to check it',
        'Reply with your address so they can check it',
        'Ignore the link and check the delivery company’s official app or site',
        'Share the message in a group chat',
      ],
      2,
      'Tiny charges are bait for card numbers. The carrier’s own service shows whether any parcel really exists, with no need to touch the message.',
    ),
    q(
      'Why do attackers often pretend to be a senior manager?',
      [
        'Staff are less likely to question a request that appears to come from authority',
        'Managers are the only people in a company who own email addresses that criminals can find',
        'It is the easiest way to avoid spam filters',
        'Senior staff never read their own messages',
      ],
      0,
      'Respect for rank makes people skip checks, so a borrowed title does the persuading that a stranger could not.',
    ),
  ],
  4: [
    q(
      'A friendly stranger at the entrance asks you to hold the door because their hands are full. What is the best response?',
      [
        'Hold it, because refusing would be rude',
        'Kindly point them to the reception desk or ask them to use their own pass',
        'Let them in and then follow them quietly around the building to see exactly where they go',
        'Hold it but only after asking where they work',
      ],
      1,
      'Courtesy and security can go together, and a quick pointer to the proper entrance costs a genuine visitor almost nothing.',
    ),
    q(
      'A message offers a prize but says you must reply within the hour. What is the main warning sign?',
      [
        'The prize is unusually large compared with anything that you have ever entered',
        'The deadline pushes you to act before you think',
        'The message mentions an hour',
        'The sender knows your first name',
      ],
      1,
      'Real offers rarely collapse in sixty minutes, but a manufactured clock is the cheapest way to cut thinking short.',
    ),
    q(
      'A caller who knows several details about you asks for one more to “complete the file”. What should you remember?',
      [
        'Knowing some facts about you proves that the caller is genuine, so it is fine to answer anything more',
        'Facts gathered from public sources can make a caller sound convincing without being genuine',
        'The more they know, the safer it is to answer',
        'It is impolite to question someone who sounds well informed',
      ],
      1,
      'Profiles, posts and old leaks supply plenty of detail, so familiarity with your background says nothing about intent.',
    ),
    q(
      'Why should unusual requests for money or gift vouchers always be double-checked?',
      [
        'Payments are never requested by email in any organisation, so any such message must be fake',
        'Fraudsters rely on rapid, hard-to-reverse payments and on people not asking questions',
        'Finance staff dislike unexpected tasks',
        'Vouchers cannot be bought online',
      ],
      1,
      'Irreversible methods leave no second chance, so a short verification before paying is the only real protection.',
    ),
    q(
      'You notice a stranger photographing a whiteboard in a meeting room. What is the best step?',
      [
        'Ignore it, because they probably belong there and nobody would photograph a board without reason',
        'Politely ask who they are and, if unsure, inform security',
        'Photograph them in return',
        'Wipe the whiteboard and say nothing',
      ],
      1,
      'A calm question and a word to the right people protect information without confrontation, and a genuine visitor will understand.',
    ),
  ],
  5: [
    q(
      'A website asks you to allow notifications as soon as it opens. What is the sensible choice?',
      [
        'Allow them, since the page cannot work properly without them and you want to read it',
        'Decline unless you know and trust the site and have a reason',
        'Allow them but only for an hour',
        'Allow them on a phone but not a computer',
      ],
      1,
      'Notification prompts are often used to push scams straight to the desktop, so the safest default is to say no.',
    ),
    q(
      'What is the risk of installing a browser extension from an unknown author?',
      [
        'Extensions can read and change the pages you visit, including sign-in pages',
        'They make every page load more slowly forever, which is their only real drawback',
        'They automatically switch off your firewall',
        'They stop the browser from receiving updates',
      ],
      0,
      'Add-ons run inside the browser with wide permissions, so a malicious one sees everything typed on every site.',
    ),
    q(
      'You are asked to log in to a site through a link in a pop-up window. How do you check that it is safe?',
      [
        'Look for any padlock in the corner of the window and continue to sign in if one is shown',
        'Close the pop-up, then open the site by typing its address or using a bookmark',
        'Compare the logo with your memory of the real one',
        'Try a wrong password first to see whether it rejects it',
      ],
      1,
      'Pop-ups can be built to resemble real windows, while an address you chose yourself is not under anyone else’s control.',
    ),
    q(
      'Which download source is acceptable for a work tool you urgently need?',
      [
        'A forum post from a user who offers a faster mirror and says it worked well for them',
        'The software catalogue or request process provided by your organisation',
        'An advertisement above the search results',
        'A link sent by a stranger who says they use it too',
      ],
      1,
      'A managed catalogue lets the right team check, license and update the tool, which random mirrors and ads cannot offer.',
    ),
    q(
      'What does it mean when a browser reports that a site’s certificate is invalid?',
      [
        'The site’s identity could not be confirmed, so the connection should not be trusted',
        'The website is just a little out of date and the warning can be ignored by most visitors',
        'Your computer clock is always the cause',
        'Only images on the page are affected',
      ],
      0,
      'The check exists to prove that you reached the real site, so a failure removes the assurance that the encryption is worth anything.',
    ),
  ],
  6: [
    q(
      'Why is it a good idea to enable automatic backup or sync for work files on an approved service?',
      [
        'It lets you recover your work if the device is lost, broken or locked by malware',
        'It makes the device run faster because less data has to be kept on the local disk',
        'It removes the need to protect the original device',
        'It stops others from ever seeing the files',
      ],
      0,
      'A copy kept elsewhere turns a disaster into an inconvenience, provided it is held somewhere the organisation manages.',
    ),
    q(
      'You find that you have been using a personal USB drive to move work files. What should you do?',
      [
        'Carry on, since it is quick and convenient and nobody has ever complained about it',
        'Stop, tell the security team and use an approved method instead',
        'Encrypt it with a simple word as the key and keep using it',
        'Hide it in a drawer at the office',
      ],
      1,
      'Small drives are easily lost and may carry malware between machines, so approved routes protect both the data and the network.',
    ),
    q(
      'Which of these screen habits protects information best in an open-plan office?',
      [
        'Leaving documents open on the screen so that colleagues can offer help quickly if needed',
        'Positioning the screen away from walkways and locking it when leaving',
        'Turning the brightness to the maximum',
        'Using a larger font so that others cannot misread it',
      ],
      1,
      'Information leaks through eyes as well as networks, and a few small habits close that path at almost no cost.',
    ),
    q(
      'What is the right way to dispose of old paper that contains personal data?',
      [
        'Put it in the ordinary recycling bin next to the printer with the rest of the paper',
        'Use the secure shredding or confidential waste service',
        'Tear it once and leave it in a pile',
        'Take it home and keep it in a box',
      ],
      1,
      'Bins are searched by people looking for exactly this, so only destruction that cannot be reversed closes the exposure.',
    ),
    q(
      'Why should you avoid installing games or unapproved programs on a work laptop?',
      [
        'They may contain hidden code and can bypass the protections the organisation has set up',
        'They always use too much memory and therefore slow down the work of the whole organisation',
        'They are forbidden in every country',
        'They will certainly be detected as soon as they are downloaded',
      ],
      0,
      'Anything unvetted widens the attack surface of a device that holds company data and connects to company systems.',
    ),
  ],
  7: [
    q(
      'You think your account may have been used by someone else. What is the best first action?',
      [
        'Change the password quietly and say nothing to anyone, so that nobody worries about it',
        'Contact the security team promptly and follow their instructions',
        'Wait a day to see if it happens again',
        'Ask colleagues if they noticed anything strange',
      ],
      1,
      'Specialists can see sign-in records and cut off a thief, while a silent change leaves the intruder’s other footholds untouched.',
    ),
    q(
      'Who should you tell about a lost security badge?',
      [
        'Nobody, as someone will probably find it and return it to the office within a day',
        'The security team or facilities team straight away',
        'Only your manager at the next meeting',
        'The person who sits next to you',
      ],
      1,
      'A lost pass can be disabled within minutes, but only if the people who control access hear about it in time.',
    ),
    q(
      'Which of these counts as something worth reporting?',
      [
        'A message that asks for your password',
        'A reminder about a team lunch',
        'A newsletter you subscribed to',
        'A calendar invitation from a colleague you know',
      ],
      0,
      'Requests for secrets are never routine, and reporting them lets specialists warn colleagues who may have received the same text.',
    ),
    q(
      'What should you do if you realise that you accidentally clicked “allow” on a suspicious prompt?',
      [
        'Close the window and forget about it',
        'Report what happened and what was shown on the screen as soon as possible',
        'Restart the computer and hope that this cancels whatever the prompt was able to start',
        'Tell nobody so that you do not get into trouble',
      ],
      1,
      'Details fresh in memory help responders judge how far the problem may have gone, and honesty gets help flowing fastest.',
    ),
    q(
      'Why is reporting a near miss useful even when nothing bad happened?',
      [
        'It shows where attackers are trying, so defences and training can be improved',
        'It earns extra points in the programme, which can later be exchanged for small rewards',
        'It gives the team something to do',
        'It proves the filters never work',
      ],
      0,
      'Every attempt that fails still teaches defenders about methods and timing, which protects the next person who is targeted.',
    ),
  ],
};

const EXTRA_FINAL_QUESTIONS: Item[] = [
  q(
    'A teammate says that using the company VPN is optional on a home network that has a strong password. Which reply is best?',
    [
      'A strong home password protects the router but not the data sent through it, so use the tunnel',
      'That is right, home networks are always private',
      'Use it only for video calls',
      'Use it only when someone else is in the house',
    ],
    0,
    'Protection at one point of a journey says little about the rest of it, and the tunnel covers the whole route.',
  ),
  q(
    'You are offered a free prize draw by a stranger who asks you to scan a code on a poster. What is the main concern?',
    [
      'The code may lead to a malicious page that is hard to judge before opening',
      'The poster is unlikely to be printed in colour, which would make the picture hard to read',
      'Codes are always too small to scan',
      'The draw might have too many winners',
    ],
    0,
    'A square pattern hides its destination from the eye, which makes it a convenient way to send people somewhere unexpected.',
  ),
  q(
    'An email thread has your manager asking you to change a supplier’s bank details today. What is the safest action?',
    [
      'Do it at once to avoid delay, since the manager would not ask without a good reason',
      'Verify with your manager and the supplier using contact details you already hold',
      'Reply asking for a signed letter',
      'Change the details but tell no one',
    ],
    1,
    'Payment diversion is a favourite fraud because the money is gone before anyone notices, so two separate confirmations are routine.',
  ),
  q(
    'What is the best use of a password manager for your most important accounts?',
    [
      'Store a unique long secret for each one and protect the vault with a strong passphrase and a second factor',
      'Keep one master password written on paper next to the screen',
      'Use it only for shopping sites',
      'Share the vault with the team so that nobody forgets',
    ],
    0,
    'The manager concentrates risk in one place, which is why that one place must carry the strongest protection available.',
  ),
  q(
    'What should you do if a work phone shows a warning that it is connected to an untrusted network?',
    [
      'Ignore it if the page you need still loads, because a working page shows that the network is fine',
      'Disconnect and switch to a trusted connection, then tell the security team if it keeps happening',
      'Turn off the phone’s security lock to improve the signal',
      'Connect more devices so they can warn you too',
    ],
    1,
    'The warning means the device saw signs of interference, and repeated sightings help specialists find fake hotspots.',
  ),
  q(
    'A new colleague asks to borrow your login for a day while their account is being set up. How do you respond?',
    [
      'Lend it, as it is only for a single day and the colleague has surely been checked already',
      'Decline and direct them to the help desk to speed up their own account',
      'Lend it but change the password afterwards',
      'Give them a shared password you both use for other tools',
    ],
    1,
    'Actions taken under your name are your responsibility, and the proper route is almost always quicker than people expect.',
  ),
  q(
    'You receive a voice message that sounds exactly like your director asking for urgent access codes. What should you bear in mind?',
    [
      'Voices can be cloned, so confirm through a second route before acting',
      'A familiar voice is conclusive proof of identity and needs no further checking',
      'Voice messages cannot be faked at all',
      'Only text messages are ever used for fraud',
    ],
    0,
    'Synthetic audio is cheap and persuasive, which is why an unusual request needs checking however familiar the speaker seems.',
  ),
  q(
    'Why should you check the sender and attachment name of an invoice even if you expect one?',
    [
      'Criminals time their messages to match real business and hope that you stop checking',
      'Invoices never contain attachments, so any file that comes with one is a warning sign by itself',
      'Expected messages are always safe',
      'Attachment names have no meaning',
    ],
    0,
    'Expectation lowers guard, which is exactly why well-timed fakes succeed and why a quick look at the details still pays off.',
  ),
  q(
    'What is a good response when a website offers to remember your card details for next time?',
    [
      'Accept on every site because it is convenient, and rely on the card issuer to deal with any problem that follows',
      'Prefer a payment method that does not store the number, or decline if you cannot be sure the site is protected',
      'Accept and use a debit card with a high balance',
      'Accept only if the site has a bright design',
    ],
    1,
    'Every site holding your card is one more place for it to leak from, so fewer copies means less exposure.',
  ),
  q(
    'A shared document containing client data is set to “anyone with the link can edit”. What is the correct action?',
    [
      'Leave it, as the link is long and hard to guess',
      'Restrict access to named people and tell the owner',
      'Add a note asking people not to share the link',
      'Download a copy for yourself',
    ],
    1,
    'A link travels easily through forwarding and chat, so access should rest on identities rather than on the secrecy of an address.',
  ),
  q(
    'What do you do if a colleague leaves their screen unlocked and open on confidential material?',
    [
      'Read it, since it is already visible and there is no harm in looking at what is on a screen',
      'Lock their screen or ask them to, and mention the habit kindly',
      'Send a joke message from their account',
      'Take a photo as proof',
    ],
    1,
    'A small kindness prevents misuse of someone’s identity, and it keeps the habit from becoming an excuse for blame later.',
  ),
  q(
    'Your laptop starts showing unexpected pop-ups after you opened a document. What is the best step?',
    [
      'Keep working and ignore them',
      'Disconnect from the network and call the security team',
      'Delete the document and hope they stop',
      'Run an online speed test',
    ],
    1,
    'Cutting the connection limits what any hidden program can reach while specialists decide what to do next.',
  ),
  q(
    'Why is it a mistake to reply to a suspicious message with “please remove me”?',
    [
      'It tells the sender that your address is active and read by a person',
      'It always reveals your home address and the name of your employer to the sender',
      'It sends a virus to the sender',
      'Replies to spam are not delivered',
    ],
    0,
    'Confirmation that someone is reading is valuable to senders, who then increase the volume and sharpen the bait.',
  ),
  q(
    'A visitor asks to use a spare network socket in a meeting room for their own laptop. What is the proper reply?',
    [
      'Agree, since the room is shared and visitors are always welcome to use what is available',
      'Offer the guest wireless network, or ask the host to arrange access',
      'Connect them yourself and show them how it works',
      'Let them borrow your login',
    ],
    1,
    'Wall ports lead straight into company systems, whereas a separate visitor service keeps outsiders away from them.',
  ),
  q(
    'What is the benefit of a documented process for reporting security concerns?',
    [
      'Everyone knows exactly whom to tell and how, so reports are fast and consistent',
      'It gives managers a reason to prevent reports from reaching the people who ought to see them',
      'It replaces the need for training',
      'It makes reports more complicated',
    ],
    0,
    'Under stress people hesitate over who to contact, and a clear path removes that delay when minutes matter most.',
  ),
];

/**
 * Moves each correct option to a position derived from the question number, so the key is spread
 * over every slot instead of clustering. Only the correct option moves; the rest keep their order.
 */
function vary<T extends { options: string[]; correctAnswer: number }>(
  items: T[],
  seed: number,
): T[] {
  return items.map((item, i) => {
    const correct = item.options[item.correctAnswer] as string;
    const rest = item.options.filter((_, idx) => idx !== item.correctAnswer);
    const target = (i + seed) % item.options.length;
    rest.splice(target, 0, correct);
    return { ...item, options: rest, correctAnswer: target };
  });
}

export const SEED_MODULES: SeedModule[] = RAW_MODULES.map((m) => ({
  ...m,
  exercises: vary(m.exercises ?? [], m.order),
}));

export const SEED_QUIZZES: Record<number, SeedAssessment> = Object.fromEntries(
  Object.entries(RAW_QUIZZES).map(([order, quiz]) => [
    Number(order),
    {
      ...quiz,
      questionsPerSession: QUIZ_QUESTIONS_PER_SESSION,
      questions: vary(
        [...quiz.questions, ...(EXTRA_QUIZ_QUESTIONS[Number(order)] ?? [])],
        Number(order),
      ),
    },
  ]),
);

export const SEED_FINAL_TEST: SeedAssessment = {
  ...RAW_FINAL_TEST,
  questionsPerSession: FINAL_TEST_QUESTIONS_PER_SESSION,
  questions: vary([...RAW_FINAL_TEST.questions, ...EXTRA_FINAL_QUESTIONS], 3),
};
