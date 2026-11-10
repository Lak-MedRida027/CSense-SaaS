import type { z } from 'zod';
import type { gateQuestionAuthoringSchema } from '@csense/shared';

/**
 * Placeholder security-gate questions for development and tests (Phase 5 seed, 30 items). Generic
 * on purpose: no client branding, plain text only. The client security team reviews and replaces
 * the pool before roll-out (Phase 7 authoring).
 *
 * Authoring rule (ADR 0007, D5-2): an explanation is shown after EVERY answer, so it teaches the
 * concept without naming the correct option. The seed test runs the shared authoring checks over
 * the whole pool (explanation echoes, correct-option length rank, near duplicates).
 */
export type SeedGateQuestion = z.input<typeof gateQuestionAuthoringSchema>;

const q = (
  topic: string,
  prompt: string,
  options: string[],
  correctAnswer: number,
  explanation: string,
): SeedGateQuestion => ({ topic, prompt, options, correctAnswer, explanation });

export const SEED_GATE_QUESTIONS: SeedGateQuestion[] = [
  q(
    'phishing',
    'An email from an unfamiliar sender says your account will be closed within the hour unless you verify it. What is the best response?',
    [
      'Click the link and sign in quickly',
      'Report it to the security team and delete it',
      'Reply to ask whether it is genuine',
      'Forward it to colleagues as a warning',
    ],
    1,
    'Pressure to act at once is a classic sign of fraud. Real services rarely threaten loss of access within hours, and flagging a suspicious email protects others as well.',
  ),
  q(
    'physical',
    'You find a USB drive in the car park labelled with a payroll year. What should you do?',
    [
      'Plug it into your laptop to look for the owner and return it',
      'Plug it into an old spare computer instead',
      'Hand it to the security team without connecting it',
      'Leave it where it is and say nothing',
    ],
    2,
    'Unknown devices can run malicious code the moment they are attached. Curiosity is exactly what attackers count on, so let specialists inspect it in a safe setting.',
  ),
  q(
    'passwords',
    'Which choice gives a new work account the strongest password?',
    [
      'Welcome2026!',
      'The name of your pet followed by the year you were born',
      'The same one that you already use for your personal email account',
      'A long phrase of several unrelated terms',
    ],
    3,
    'Length and unpredictability protect an account far better than clever character swaps. A string that software cannot anticipate stays safe even when one site leaks.',
  ),
  q(
    'social engineering',
    'A caller claiming to be from IT asks for your password to fix an urgent fault. What do you do?',
    [
      'Give it to them, because people who work in IT are always trusted with it',
      'Give only the first half',
      'Ask them to email the request',
      'Refuse, then phone the helpdesk using a number you already have',
    ],
    3,
    'Genuine support never needs your secret, and a caller voice is easy to fake. Checking through a channel you start yourself removes the doubt.',
  ),
  q(
    'data handling',
    'You must share a spreadsheet of customer details with a colleague. Which method is appropriate?',
    [
      'A personal webmail account',
      'The approved sharing tool, limited to named people',
      'A public link that anyone can open',
      'A direct message on a social network',
    ],
    1,
    'Company data belongs in systems the organisation manages, where permissions can be reviewed and withdrawn later and nothing travels through accounts nobody controls.',
  ),
  q(
    'authentication',
    'What does multi-factor authentication add to a sign-in?',
    [
      'A second proof of identity in addition to the password',
      'A longer minimum password length',
      'Faster access on trusted laptops',
      'Automatic monthly changes',
    ],
    0,
    'Even when a secret is stolen, an attacker still lacks the other thing needed to get in, so a single leak no longer opens the door.',
  ),
  q(
    'safe browsing',
    'A web page demands a browser update before it will play a video. What is the safest action?',
    [
      'Install it straight away, since some videos really do need updates and newer software',
      'Install it and run a scan afterwards',
      'Close the page and update only from the browser settings',
      'Accept every prompt that appears',
    ],
    2,
    'Pop-ups imitate genuine prompts to deliver unwanted software. Trusted updates arrive through channels you open yourself.',
  ),
  q(
    'physical',
    'You see someone you do not recognise following staff through a secure door. What is the best action?',
    [
      'Hold the door open for them because they look very busy and in a hurry to get inside',
      'Politely ask who they are visiting and offer to take them to reception',
      'Ignore it, security is not your job',
      'Take a photo of them and post it in the team chat so everyone can see who it is',
    ],
    1,
    'Tailgating relies on politeness. Guiding a visitor to the proper desk keeps doors secure without any confrontation.',
  ),
  q(
    'remote work',
    'You are working from a cafe. Which connection is the safest for company work?',
    [
      'The free open network named after the cafe or shop',
      'A neighbour table network the owner shared',
      'The company VPN over your own phone hotspot',
      'Any network, if the site address starts with https',
    ],
    2,
    'Anyone can set up an access point with a convincing name. An encrypted tunnel to the organisation keeps traffic private whatever the café offers.',
  ),
  q(
    'reporting',
    'You clicked a link in an email and now suspect it was a trick. What should you do first?',
    [
      'Tell the security team immediately, even if you feel embarrassed',
      'Wait to see whether anything happens',
      'Restart the laptop and carry on',
      'Delete your browsing history',
    ],
    0,
    'Speed limits damage, and nobody is penalised for honest reports. Hiding a mistake lets the problem spread while responders work blind.',
  ),
  q(
    'phishing',
    'Which detail in a message most strongly suggests it is not genuine?',
    [
      'It addresses you by your first name and mentions a project you work on',
      'It arrives during working hours',
      'The sender address uses a slightly misspelt company domain',
      'It contains a company logo and a signature block that looks official',
    ],
    2,
    'Logos and names are easy to copy, but look-alike names are hard for a fraudster to avoid, so reading the details carefully pays off.',
  ),
  q(
    'devices',
    'Your laptop shows a notice that updates are ready. When is the best time to install them?',
    [
      'As soon as you reach a convenient pause',
      'Never, updates slow things down',
      'Only after something breaks',
      'Once a year during a holiday',
    ],
    0,
    'Updates fix flaws that attackers already know about. Each day of delay widens the window they can use.',
  ),
  q(
    'data handling',
    'You are about to print a document marked confidential. What should you do after printing?',
    [
      'Leave it on the printer for a while',
      'Collect it straight away and store or shred it when finished',
      'Put it in the nearest recycling bin',
      'Photograph it so you can throw it away',
    ],
    1,
    'Paper is data too. Anyone passing a shared printer can read what is left there, and ordinary bins are easy to search.',
  ),
  q(
    'social engineering',
    'A message from your manager asks you to buy gift cards urgently and send the codes by reply. What is the most sensible step?',
    [
      'Buy them quickly to help',
      'Confirm the request with your manager using a different channel',
      'Buy only a few as a test',
      'Reply to ask for more detail about the budget and who has approved it first',
    ],
    1,
    'Fraudsters borrow the names of senior people and add urgency so you skip checks. A second route breaks the illusion in seconds.',
  ),
  q(
    'passwords',
    'What is the best way to keep track of many unique passwords?',
    [
      'Write them on a note beside the monitor',
      'Reuse a single strong one everywhere',
      'Store them in a spreadsheet named passwords',
      'Use an approved password manager',
    ],
    3,
    'Nobody can memorise dozens of secrets, so a vault with one strong key lets every account have a different one.',
  ),
  q(
    'devices',
    'You leave your desk for a short meeting. What should you do with your computer?',
    [
      'Lock the screen before you walk away',
      'Dim the screen so that nobody around you notices anything unusual',
      'Leave it, the office is friendly',
      'Close the lid only if you will be gone an hour',
    ],
    0,
    'Short absences are when opportunists strike. Securing it takes a second and keeps your identity attached to your own actions.',
  ),
  q(
    'phishing',
    'A text message says a parcel could not be delivered and offers a link to rearrange it, but you ordered nothing. What now?',
    [
      'Open the link just to check whether it is something you ordered',
      'Reply STOP to unsubscribe',
      'Delete it, and never follow links in unexpected messages',
      'Forward it to a friend who is expecting a parcel',
    ],
    2,
    'Fake delivery notices harvest details from anyone who clicks. Replying or opening anything confirms that your number is active.',
  ),
  q(
    'remote work',
    'You work at home and a family member asks to borrow your work laptop for a game. What is the right answer?',
    [
      'Yes, as long as they are careful',
      'Yes, after you switch to a guest account',
      'No, work devices are only for work and the person authorised to use them',
      'Yes, if you stay beside them',
    ],
    2,
    'Company equipment carries company access. Sharing it adds risks that nobody agreed to, however trustworthy the borrower.',
  ),
  q(
    'data handling',
    'Which of these is the safest place to discuss a confidential project?',
    [
      'A busy train carriage',
      'A video call from a lift lobby',
      'A private room or an approved call platform where nobody can overhear',
      'A table at a crowded lunch spot near the entrance of a busy cafe downtown',
    ],
    2,
    'Conversations carry information like documents do. Choose settings where only the intended listeners are present.',
  ),
  q(
    'authentication',
    'You receive a sign-in approval request on your phone that you did not start. What do you do?',
    [
      'Approve it to stop the notifications',
      'Deny it and tell the security team',
      'Wait and see if it repeats',
      'Approve it, then change your password',
    ],
    1,
    'An unexpected prompt means someone may already know your password and is hoping you give in. Refusing and reporting stops them and starts an investigation.',
  ),
  q(
    'social engineering',
    'A visitor in a delivery uniform asks to be let into the server room to drop a parcel. What is the best response?',
    [
      'Let them in right away because they are wearing a uniform and look official',
      'Accept the parcel at reception and let the usual process handle it',
      'Ask them to wait inside the server room while you go and check with a manager',
      'Give them your badge for a moment',
    ],
    1,
    'Uniforms are cheap props. Sensitive areas stay protected when every entry follows the same rules, however polite the request.',
  ),
  q(
    'safe browsing',
    'What should you check before entering your password on a web page?',
    [
      'That the page loads quickly and looks like the one you used last time',
      'That the address is the one you expect, not one from a message link',
      'That the page has a padlock icon',
      'That the logo looks right',
    ],
    1,
    'Padlocks and logos can be copied by anyone. Typing the known web name yourself is the dependable way to be sure whose site it is.',
  ),
  q(
    'devices',
    'Your phone is used for work email. Which setting matters most if it is lost?',
    [
      'A bright screen',
      'A lock screen code and remote wipe enabled',
      'A large battery',
      'A short ring tone',
    ],
    1,
    'A phone in the wrong hands exposes everything signed in on it. A passcode buys time, and distant controls let the owner finish the job.',
  ),
  q(
    'reporting',
    'Who should you tell when you notice something that looks like a security problem, even a small one?',
    [
      'Nobody at all, because someone else will surely have seen it already',
      'The person sitting next to you only',
      'Whoever the security team names as the reporting contact',
      'The press office',
    ],
    2,
    'Every incident starts as a small oddity somebody noticed. A single reliable route lets responders see patterns that individuals cannot.',
  ),
  q(
    'data handling',
    'A customer emails asking you to confirm their account balance. How do you proceed?',
    [
      'Reply with the figure straight away because the customer is waiting for it',
      'Verify who they are using the agreed process before sharing anything',
      'Reply asking for their full card number and the security code on the back',
      'Ignore it',
    ],
    1,
    'Anybody can write an email pretending to be somebody else. Identity comes first, and details follow afterwards.',
  ),
  q(
    'passwords',
    'When is it appropriate to share your account password with a trusted colleague?',
    [
      'When they are covering your leave and need to finish your daily tasks',
      'When your manager asks you nicely in person or by a direct message',
      'Never, ask for the right access to be granted to them instead',
      'When the system is slow',
    ],
    2,
    'Shared secrets destroy accountability, because actions can no longer be traced to a person. Proper permissions give the colleague what they need.',
  ),
  q(
    'phishing',
    'You receive an invoice attachment you did not expect from a known supplier. What is the safest step?',
    [
      'Open it straight away because you already know and trust the supplier',
      'Contact the supplier on a number you already have before opening it',
      'Open it in preview mode only',
      'Save it to your desktop and open it later when you have more time free',
    ],
    1,
    'Accounts of real suppliers get hijacked and used to deliver malicious files. A quick call settles whether they really sent it.',
  ),
  q(
    'remote work',
    'Which statement about using personal cloud storage for work files is correct?',
    [
      'It is fine for short documents',
      'It is fine if the folder is private',
      'It is not allowed unless the organisation has approved that service',
      'It is fine when the office network is down and a deadline is coming up',
    ],
    2,
    'Data that leaves managed systems cannot be protected, recovered or deleted by those responsible for it, however convenient the shortcut seems.',
  ),
  q(
    'social engineering',
    'Someone you met online asks detailed questions about your employer and its systems. How should you respond?',
    [
      'Answer everything, since information that is already public is harmless',
      'Share details gradually to build trust',
      'Decline to discuss work and tell the security team if they continue',
      'Send them a copy of the organisation chart',
    ],
    2,
    'Small harmless-looking facts are assembled into a picture that makes a later attack convincing. Keeping job talk private starves that process.',
  ),
  q(
    'physical',
    'You notice a colleague has left a badge on a desk overnight. What is the best action?',
    [
      'Leave it, it is not yours',
      'Use it to get into the building early and make a start on your work',
      'Hand it to security so it can be deactivated and returned',
      'Post a photo of it in the chat to ask whose badge it might be',
    ],
    2,
    'A lost credential works for anyone who picks it up. Staff who handle it properly let access be cancelled before it is misused.',
  ),
];
