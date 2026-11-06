import { LEVELS } from '@csense/shared';
import { useCallback, useState, type ReactNode } from 'react';
import {
  AchievementBadge,
  Alert,
  AttemptsIndicator,
  Avatar,
  BadgeGrid,
  BarChart,
  BrandLogo,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  EscalationList,
  FeedbackPanel,
  FilterBar,
  IconButton,
  InteractiveExercise,
  LevelChip,
  LevelLadder,
  Link,
  LockdownBanner,
  ModuleCard,
  ModuleList,
  Pagination,
  PasswordField,
  ProgressBar,
  ProgressRing,
  QuestionNavigator,
  QuizOption,
  QuizQuestion,
  RadioGroup,
  RiskBreakdown,
  RiskChip,
  Scoreboard,
  ScoreSummary,
  SearchField,
  Select,
  Skeleton,
  SkeletonText,
  Spinner,
  StatTile,
  Stepper,
  Switch,
  Tabs,
  TextField,
  ToastRegion,
  Tooltip,
  TranscriptPanel,
  VideoPlayerFrame,
  XPBar,
  type SortState,
  type ToastItem,
} from '../../components';
import { STATUS_TONES } from '../../design/tokens';
import { ArrowRight, Mail, Search, Settings, Trash, Zap } from './galleryIcons';
import { adminDashboardFixture } from '../../screens/AdminDashboard/AdminDashboard.fixtures';
import { fixtureBadges, fixtureModuleList, fixtureModules } from '../../screens/shared.fixtures';
import styles from './Styleguide.module.css';

function Demo({
  title,
  children,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <section className={wide ? styles.demoWide : styles.demo} aria-label={title}>
      <h2 className={styles.h3}>{title}</h2>
      <div className={styles.demoBody}>{children}</div>
    </section>
  );
}

const noop = (): void => undefined;
const sampleBadge = fixtureBadges[2];
const sampleModule = fixtureModules[0];

/** Every component in its documented states (see docs/design/components.md). */
export function ComponentGallery() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [radio, setRadio] = useState<string | null>('b');
  const [checked, setChecked] = useState(true);
  const [switchOn, setSwitchOn] = useState(false);
  const [quizPick, setQuizPick] = useState<string | null>('b');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(2);
  const [sort, setSort] = useState<SortState<'name' | 'score'>>({ key: 'name', direction: 'asc' });
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const dismissToast = useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  return (
    <div className={styles.gallery}>
      <Demo title="Button">
        <div className={styles.row}>
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger" iconStart={Trash}>
            Delete
          </Button>
        </div>
        <div className={styles.row}>
          <Button size="sm">Small (44px hit area)</Button>
          <Button size="lg" iconEnd={ArrowRight}>
            Large
          </Button>
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
          <Tooltip content="Finish the lesson first">
            <Button softDisabled>Soft disabled</Button>
          </Tooltip>
        </div>
      </Demo>

      <Demo title="IconButton, Tooltip, Link">
        <div className={styles.row}>
          <IconButton icon={Settings} label="Settings" />
          <IconButton icon={Search} label="Search" variant="secondary" />
          <IconButton icon={Settings} label="Small settings" size="sm" />
          <IconButton icon={Settings} label="Loading settings" loading />
          <IconButton icon={Settings} label="Disabled settings" disabled />
          <Link href="#/styleguide/components">In-app link</Link>
          <Link href="https://www.ncsc.gov.uk" external>
            External link
          </Link>
        </div>
      </Demo>

      <Demo title="TextField and PasswordField">
        <div className={styles.formGrid}>
          <TextField
            label="Work email"
            placeholder="name@company.com"
            leadingIcon={Mail}
            hint="Use your company address."
          />
          <TextField
            label="Email (error)"
            defaultValue="amina@"
            error="Enter a valid email address."
          />
          <TextField label="Disabled" defaultValue="locked@example.com" disabled />
          <TextField label="Required" required />
          <PasswordField label="Password" />
        </div>
      </Demo>

      <Demo title="Checkbox, RadioGroup, Select, Switch">
        <div className={styles.formGrid}>
          <Checkbox
            label="Remember this device"
            description="Only on your managed workstation."
            checked={checked}
            onChange={(e) => {
              setChecked(e.currentTarget.checked);
            }}
          />
          <Checkbox label="Disabled option" disabled />
          <Checkbox label="With error" error="You must accept the policy." />
          <RadioGroup
            legend="Report type"
            value={radio}
            onChange={setRadio}
            options={[
              { value: 'a', label: 'Compliance summary' },
              { value: 'b', label: 'Training progress', description: 'By employee and module' },
              { value: 'c', label: 'Unavailable', disabled: true },
            ]}
          />
          <Select
            label="Department"
            placeholder="All departments"
            options={[
              { value: 'ops', label: 'Operations' },
              { value: 'fin', label: 'Finance' },
            ]}
          />
          <Select label="Loading select" options={[]} loading />
          <Select label="Empty select" options={[]} />
          <Select
            label="Select with error"
            options={[{ value: 'x', label: 'X' }]}
            error="Choose a department."
          />
          <Switch
            label="Reduce motion"
            description="Turns off celebrations."
            checked={switchOn}
            onChange={setSwitchOn}
          />
          <Switch label="Disabled switch" checked={false} onChange={noop} disabled />
        </div>
      </Demo>

      <Demo title="Alert and Toast">
        {STATUS_TONES.map((tone) => (
          <Alert
            key={tone}
            tone={tone}
            title={`${tone[0]?.toUpperCase() ?? ''}${tone.slice(1)} message`}
            announce={false}
          >
            Status is shown by icon shape and title text as well as colour.
          </Alert>
        ))}
        <div className={styles.row}>
          {STATUS_TONES.map((tone) => (
            <Button
              key={tone}
              variant="secondary"
              size="sm"
              onClick={() => {
                setToasts((t) => [
                  ...t,
                  { id: `${tone}-${Date.now()}`, tone, message: `A ${tone} toast` },
                ]);
              }}
            >
              Show {tone} toast
            </Button>
          ))}
        </div>
        <ToastRegion toasts={toasts} onDismiss={dismissToast} />
      </Demo>

      <Demo title="Dialog and ConfirmDialog">
        <div className={styles.row}>
          <Button
            variant="secondary"
            onClick={() => {
              setDialogOpen(true);
            }}
          >
            Open dialog
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmOpen(true);
            }}
          >
            Open confirm
          </Button>
        </div>
        <Dialog
          open={dialogOpen}
          title="Badge: Phish Spotter"
          description="Awarded for passing the Phishing module."
          onClose={() => {
            setDialogOpen(false);
          }}
          footer={
            <Button
              onClick={() => {
                setDialogOpen(false);
              }}
            >
              Close
            </Button>
          }
        >
          {sampleBadge && <AchievementBadge badge={sampleBadge} size="lg" />}
        </Dialog>
        <ConfirmDialog
          open={confirmOpen}
          title="Leave the quiz?"
          description="Your answers won't be saved and this counts as an attempt."
          confirmLabel="Leave quiz"
          cancelLabel="Keep going"
          tone="danger"
          onConfirm={() => {
            setConfirmOpen(false);
          }}
          onCancel={() => {
            setConfirmOpen(false);
          }}
        />
      </Demo>

      <Demo title="Card states">
        <div className={styles.cardGrid}>
          <Card title="Ready">Content goes here.</Card>
          <Card title="Loading" state="loading" />
          <Card title="Empty" state="empty" emptyDescription="Complete a module to see results." />
          <Card title="Error" state="error" onRetry={noop} />
        </div>
      </Demo>

      <Demo title="EmptyState, ErrorState, Spinner, Skeleton">
        <div className={styles.cardGrid}>
          <EmptyState
            icon={Zap}
            title="No activity yet"
            description="Your recent activity appears here."
            compact
          />
          <ErrorState description="Could not reach the server." onRetry={noop} compact />
          <div className={styles.row}>
            <Spinner size="sm" />
            <Spinner />
            <Spinner size="lg" />
          </div>
          <div>
            <Skeleton width="60%" height="1.25rem" />
            <SkeletonText lines={3} />
          </div>
        </div>
      </Demo>

      <Demo title="Tabs and Stepper" wide>
        <Tabs
          label="Example tabs"
          items={[
            { id: 'a', label: 'Overview', content: <p>Overview panel.</p> },
            { id: 'b', label: 'Employees', count: 128, content: <p>Employees panel.</p> },
            { id: 'c', label: 'Disabled', disabled: true, content: null },
          ]}
        />
        <Stepper
          label="Example steps"
          steps={[
            { id: '1', label: 'Sign in', status: 'complete' },
            { id: '2', label: 'Security check', status: 'current' },
            { id: '3', label: 'Access granted', status: 'upcoming' },
          ]}
        />
        <Stepper
          label="Example error steps"
          steps={[
            { id: '1', label: 'Sign in', status: 'complete' },
            { id: '2', label: 'Security check', status: 'error' },
            { id: '3', label: 'Access granted', status: 'upcoming' },
          ]}
        />
      </Demo>

      <Demo title="Progress" wide>
        <div className={styles.formGrid}>
          <ProgressBar
            label="Modules complete"
            value={3}
            max={7}
            valueText="3 of 7 modules"
            tone="success"
          />
          <ProgressBar label="Uploading" value={0} indeterminate />
          <ProgressBar label="Empty" value={0} />
          <XPBar
            totalXP={1240}
            currentLevel="Practitioner"
            currentLevelFloorXP={900}
            nextLevelXP={2000}
            nextLevel="Guardian"
          />
          <XPBar
            totalXP={4100}
            currentLevel="Defender"
            currentLevelFloorXP={3500}
            nextLevelXP={undefined}
            nextLevel={undefined}
          />
        </div>
        <div className={styles.row}>
          <ProgressRing
            label="XP progress"
            value={340}
            max={1100}
            level="Practitioner"
            valueText="1,240 XP"
          >
            <strong>1,240</strong>
            <span>XP</span>
          </ProgressRing>
          <ProgressRing label="Completion" value={62} tone="info" size={96}>
            <strong>62%</strong>
          </ProgressRing>
          <ProgressRing label="Loading" value={0} loading size={96} />
        </div>
      </Demo>

      <Demo title="Levels" wide>
        <div className={styles.row}>
          {LEVELS.map((l) => (
            <LevelChip key={l} level={l} />
          ))}
        </div>
        <div className={styles.row}>
          {LEVELS.map((l) => (
            <LevelChip key={l} level={l} size="sm" compact />
          ))}
        </div>
        <LevelLadder
          currentLevel="Practitioner"
          thresholds={{
            Apprentice: 0,
            Aware: 300,
            Practitioner: 900,
            Guardian: 2000,
            Defender: 3500,
          }}
        />
      </Demo>

      <Demo title="Badges" wide>
        <BadgeGrid label="Badges" badges={fixtureBadges} onOpenBadge={noop} />
        <BadgeGrid label="Loading badges" badges={[]} state="loading" loadingCount={3} />
        <BadgeGrid label="No badges" badges={[]} />
      </Demo>

      <Demo title="StatTile" wide>
        <div className={styles.cardGrid}>
          <StatTile
            label="Training completion"
            value={62}
            unit="%"
            delta={{ text: '+4% vs last month', direction: 'up', sentiment: 'positive' }}
            onActivate={noop}
          />
          <StatTile
            label="High-risk employees"
            value={9}
            unit="people"
            tone="critical"
            delta={{ text: '+2 this week', direction: 'up', sentiment: 'negative' }}
          />
          <StatTile label="Loading" value={0} state="loading" />
          <StatTile label="Empty" value={0} state="empty" />
        </div>
      </Demo>

      <Demo title="Risk" wide>
        <div className={styles.row}>
          <RiskChip level="Low" />
          <RiskChip level="Medium" />
          <RiskChip level="High" showGovernance />
          <RiskChip level={null} />
          <RiskChip level="Low" loading />
        </div>
        <RiskBreakdown
          scores={{ knowledge: 35, behavioural: 60, simulation: 85, engagement: 40 }}
          composite={72}
          level="High"
        />
      </Demo>

      <Demo title="ModuleCard and ModuleList" wide>
        <div className={styles.cardGrid}>
          {fixtureModules.slice(2, 5).map((m) => (
            <ModuleCard
              key={m.id}
              module={m}
              totalModules={7}
              lockedReason="Pass the Module 4 quiz to unlock"
              onOpen={noop}
            />
          ))}
          {sampleModule && <ModuleCard module={sampleModule} totalModules={7} state="loading" />}
        </div>
        <div className={styles.narrow}>
          <ModuleList
            modules={fixtureModuleList}
            currentId="m4"
            onSelect={noop}
            finalAssessment={{ status: 'locked', lockedReason: 'Unlocks after all 7 modules' }}
          />
        </div>
      </Demo>

      <Demo title="VideoPlayerFrame and TranscriptPanel" wide>
        <div className={styles.cardGrid}>
          <VideoPlayerFrame title="Phishing basics" />
          <VideoPlayerFrame title="Loading" state="loading" />
          <VideoPlayerFrame title="Error" state="error" onRetry={noop} />
          <TranscriptPanel
            cues={[
              { id: '1', startSeconds: 0, text: 'Phishing is the most common way in.' },
              { id: '2', startSeconds: 14, text: 'Check the sender address.' },
            ]}
            activeCueId="2"
            onSeek={noop}
          />
        </div>
      </Demo>

      <Demo title="Quiz pieces" wide>
        <div role="radiogroup" aria-label="Quiz option states" className={styles.stack}>
          <QuizOption
            name="g1"
            optionId="a"
            letter="A"
            label="Default option"
            checked={quizPick === 'a'}
            onSelect={setQuizPick}
          />
          <QuizOption
            name="g1"
            optionId="b"
            letter="B"
            label="Selected option"
            checked={quizPick === 'b'}
            onSelect={setQuizPick}
          />
          <QuizOption
            name="g1"
            optionId="c"
            letter="C"
            label="Disabled option"
            checked={false}
            onSelect={noop}
            disabled
          />
        </div>
        <div role="radiogroup" aria-label="Review states" className={styles.stack}>
          <QuizOption
            name="g2"
            optionId="a"
            letter="A"
            label="Your wrong answer"
            checked
            onSelect={noop}
            review={{ isCorrect: false, isSelected: true }}
          />
          <QuizOption
            name="g2"
            optionId="b"
            letter="B"
            label="The correct answer"
            checked={false}
            onSelect={noop}
            review={{ isCorrect: true, isSelected: false }}
          />
        </div>
        <QuizQuestion
          questionNumber={2}
          totalQuestions={5}
          stem="Which sign suggests phishing?"
          options={[
            { id: 'a', text: 'Mismatched link' },
            { id: 'b', text: 'Sent at 9am' },
          ]}
          selectedOptionId="b"
          onSelect={noop}
          mode="review"
          correctOptionId="a"
          explanation="Hover links to see where they really go."
        />
        <FeedbackPanel correct explanation="Reporting protects everyone." focusOnMount={false} />
        <FeedbackPanel
          correct={false}
          explanation="IT will never ask for your password."
          focusOnMount={false}
        />
        <InteractiveExercise
          scenarioNumber={1}
          totalScenarios={4}
          prompt="What should you do?"
          choices={[
            { id: 'a', text: 'Click it' },
            { id: 'b', text: 'Report it' },
          ]}
          selectedChoiceId={null}
          onAnswer={noop}
          onNext={noop}
        />
        <QuestionNavigator
          questions={Array.from({ length: 15 }, (_, i) => ({
            id: String(i),
            answered: i < 6,
            flagged: i === 4,
          }))}
          currentIndex={6}
          onJump={noop}
        />
        <div className={styles.row}>
          <AttemptsIndicator remaining={3} max={3} />
          <AttemptsIndicator remaining={1} max={3} />
          <AttemptsIndicator remaining={0} max={3} />
        </div>
      </Demo>

      <Demo title="LockdownBanner" wide>
        <LockdownBanner state="entering" onRequestExit={noop} />
        <LockdownBanner state="active" onRequestExit={noop} />
        <LockdownBanner state="failed" onRequestExit={noop} />
      </Demo>

      <Demo title="ScoreSummary" wide>
        <div className={styles.cardGrid}>
          <ScoreSummary
            title="Module 3 quiz"
            scorePercent={80}
            passMarkPercent={70}
            passed
            correctCount={4}
            totalCount={5}
            xpEarned={150}
            onReview={noop}
            onContinue={noop}
          />
          <ScoreSummary
            title="Module 3 quiz"
            scorePercent={60}
            passMarkPercent={70}
            passed={false}
            correctCount={3}
            totalCount={5}
            onReview={noop}
            onRetry={noop}
          />
        </div>
      </Demo>

      <Demo title="Admin: filters, table, pagination" wide>
        <FilterBar
          label="Example filters"
          activeCount={search ? 1 : 0}
          onClear={() => {
            setSearch('');
          }}
        >
          <SearchField
            label="Search"
            value={search}
            onChange={setSearch}
            resultCountText={`${search ? 3 : 128} employees found`}
          />
        </FilterBar>
        <DataTable
          caption="Example table"
          rows={[
            { id: '1', name: 'Amina Benali', score: 80 },
            { id: '2', name: 'Karim Diaz', score: 40 },
          ]}
          rowKey={(r) => r.id}
          sort={sort}
          onSortChange={setSort}
          columns={[
            {
              key: 'name',
              header: 'Name',
              render: (r) => r.name,
              sortable: true,
              isRowHeader: true,
            },
            {
              key: 'score',
              header: 'Score',
              render: (r) => `${r.score}%`,
              sortable: true,
              align: 'end',
            },
          ]}
        />
        <DataTable
          caption="Loading table"
          rows={[]}
          rowKey={() => ''}
          state="loading"
          loadingRowCount={2}
          columns={[{ key: 'a', header: 'A', render: () => null }]}
        />
        <DataTable
          caption="Empty table"
          rows={[]}
          rowKey={() => ''}
          columns={[{ key: 'a', header: 'A', render: () => null }]}
          emptyTitle="No employees match"
        />
        <Pagination page={page} pageCount={12} onPageChange={setPage} />
      </Demo>

      <Demo title="Charts, scoreboard and escalations" wide>
        <BarChart
          title="Completion by module"
          data={adminDashboardFixture.moduleCompletion}
          headingLevel={3}
        />
        <Scoreboard
          title="Risk scoreboard"
          entries={adminDashboardFixture.riskScoreboard}
          onOpenEntry={noop}
          headingLevel={3}
        />
        <EscalationList
          title="Escalations"
          items={adminDashboardFixture.escalations}
          onReview={noop}
          headingLevel={3}
        />
        <EscalationList title="No escalations" items={[]} headingLevel={3} />
      </Demo>

      <Demo title="Avatar and BrandLogo">
        <div className={styles.row}>
          <Avatar name="Amina Benali" size="sm" />
          <Avatar name="Karim Diaz" />
          <Avatar name="Sofia" size="lg" decorative={false} />
          <BrandLogo variant="mark" height={32} />
          <BrandLogo variant="wordmark" height={32} />
        </div>
      </Demo>
    </div>
  );
}
