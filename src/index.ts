import { createModel } from '@xstate/test';
import type { EventExecutor, TestEventsConfig, TestPath, TestPlan, TestSegmentResult } from '@xstate/test/lib/types';
import type { AnyEventObject, EventObject, MachineConfig, MachineOptions, State } from 'xstate';
import { Machine } from 'xstate';

export type StatesTestFunctions<TContext, TTestContext> = {
  [property: string]:
    | ((testContext: TTestContext, state: State<TContext, any>) => Promise<void> | void)
    | StatesTestFunctions<TContext, TTestContext>;
};

export enum LogLevel {
  None = 'NONE',
  Info = 'INFO',
  Debug = 'DEBUG',
  Trace = 'TRACE',
}

type Logger = (level: LogLevel, ...messages: unknown[]) => void;

const createLogger = (config: LogLevel) => {
  const { None, Info, Debug, Trace } = LogLevel;
  const levels = { [None]: [] as LogLevel[], [Info]: [Info], [Debug]: [Info, Debug], [Trace]: [Info, Debug, Trace] };
  const currentLevel = levels[config];

  return (given: LogLevel, message: any, ...additonalParams: any[]) => {
    if (currentLevel.includes(given) && message) {
      console.log(`[${given}] ${message}`, ...additonalParams);
    }
  };
};

const enhanceStatechartWithMetaTest = <TContext, TEvents extends EventObject, TTestContext>(
  statechart: MachineConfig<TContext, any, TEvents>,
  tests: StatesTestFunctions<TContext, TTestContext>,
  logger: Logger,
): any => ({
  ...statechart,
  states: Object.entries(statechart.states || {}).reduce((s, [stateKey, stateValue]) => {
    const test = tests[stateKey];

    return {
      ...s,
      [stateKey]: {
        ...stateValue,
        ...(stateValue.states
          ? enhanceStatechartWithMetaTest(stateValue, typeof test !== 'function' ? test : {}, logger)
          : {
              meta: {
                ...stateValue.meta,
                test: (testContext: TTestContext, state: State<TContext, any>) => {
                  logger(LogLevel.Debug, `    ${stateKey}`);

                  if (typeof test === 'function') {
                    return test(testContext, state);
                  }
                },
              },
            }),
      },
    };
  }, {}),
});

const wrapEventExecutor = <TTestContext>(
  logger: Logger,
  key: string,
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  action: EventExecutor<TTestContext> = () => {},
) => async (testContext: TTestContext, event: EventObject) => {
  logger(LogLevel.Debug, `    → ${key}`);
  await action(testContext, event);
};

const enhanceTestEvents = <TTestContext>(
  testEvents: TestEventsConfig<TTestContext>,
  logger: Logger,
): TestEventsConfig<TTestContext> =>
  Object.entries(testEvents).reduce(
    (enhancedTestEvents, [eventKey, eventAction]) => ({
      ...enhancedTestEvents,
      [eventKey]:
        typeof eventAction === 'function'
          ? wrapEventExecutor(logger, eventKey, eventAction)
          : {
              ...eventAction,
              exec: wrapEventExecutor(logger, eventKey, eventAction.exec),
            },
    }),
    {},
  );

const stringifySegments = (segments: TestSegmentResult['segment'][]) =>
  segments.reduce((s, { state, event }) => [...s, state.value.toString(), event.type], [] as string[]).join(' → ');

const enrichPathDescription = <TTestContext>(path: TestPath<TTestContext>) => ({
  ...path,
  description: stringifySegments(path.segments),
});

const getUniqueTestPlans = <TTestContext, TContext>(plans: TestPlan<TTestContext, TContext>[]) => {
  const pathMap = new Map<string, TestPlan<TTestContext, TContext>>();

  return plans.reduce<TestPlan<TTestContext, TContext>[]>((uniquePlans, plan) => {
    if (pathMap.has(plan.description)) {
      const existingPlan = pathMap.get(plan.description);
      plan.paths.forEach((path) => {
        if (!existingPlan!.paths.some(({ segments }) => stringifySegments(segments) === stringifySegments(path.segments))) {
          existingPlan!.paths.push(enrichPathDescription(path));
        }
      });
    } else {
      const unique = { ...plan, paths: plan.paths.map((path) => enrichPathDescription(path)) };
      pathMap.set(plan.description, unique);
      uniquePlans.push(unique);
    }

    return uniquePlans;
  }, []);
};

const getGuardCombinations = <TContext, TEvents extends EventObject>(
  guards: MachineOptions<TContext, TEvents>['guards'],
) => {
  const guardKeys = Object.keys(guards);
  const guardCombinations: Record<string, () => boolean>[] = [];
  for (let i = 0; i < 1 << guardKeys.length; i++) {
    const combination: Record<string, () => boolean> = {};
    for (let j = 0; j < guardKeys.length; j++) {
      combination[guardKeys[j]] = () => !!(i & (1 << j));
    }

    guardCombinations.push(combination);
  }

  return guardCombinations;
};

const stringifyTestPlans = (testPlans: TestPlan<any, any>[]) =>
  `
=================================================================
TestPlans:
=================================================================

${testPlans.reduce(
  (s, { description, paths }) => `${s}
  ${description}${paths.reduce(
    (s, { description }) => `${s}
    • ${description} ⬏`,
    '',
  )}`,
  '',
)}

=================================================================`;

export const createTestPlans = <
  TMachinConfig,
  TMachineOptions extends Record<string, any>,
  TTestContext,
  TContext,
  TEvents extends EventObject = AnyEventObject
>({
  statechart,
  tests,
  testEvents,
  machineConfig: { guards = {} },
  logLevel = LogLevel.None,
}: {
  statechart: TMachinConfig;
  tests: StatesTestFunctions<TContext, TTestContext>;
  testEvents: TestEventsConfig<TTestContext>;
  machineConfig: TMachineOptions;
  logLevel?: LogLevel;
}): TestPlan<TTestContext, TContext>[] => {
  const logger = createLogger(logLevel);
  const testStatecart = enhanceStatechartWithMetaTest<TContext, TEvents, TTestContext>(statechart, tests, logger);
  const events = enhanceTestEvents(testEvents, logger);
  const guardCombinations = getGuardCombinations<TContext, TEvents>(guards);
  const possibleTestPlans =
    guardCombinations.length > 0
      ? guardCombinations.reduce(
          (plans, guards) => [
            ...plans,
            ...createModel<TTestContext, TContext>(Machine(testStatecart, { guards }))
              .withEvents(events)
              .getSimplePathPlans(),
          ],
          [] as TestPlan<TTestContext, TContext>[],
        )
      : createModel<TTestContext, TContext>(Machine(testStatecart)).withEvents(events).getSimplePathPlans();
  const testPlans = getUniqueTestPlans(possibleTestPlans);

  logger(LogLevel.Info, stringifyTestPlans(testPlans));

  return testPlans;
};
