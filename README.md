# @smartive/xstate-test-toolbox

This package contains the helper `createTestPlans` which we use for our work with xstate, @xstate/test and TestCafe.

## `createTestPlans`

This functions add the `meta`-property to every state and adds a test if it is defined within the `tests` property. (see in example) Beside that it generates all possible test plans and paths for all possible states of your guards within the machineConfig.

⚠️ Attention: Your statechart must consist of only string references for guards, actions and services otherwise the testing will break.

### Example

```Typescript
// The following snippet does not include all needed imports and code it is intended
// to give you a starting point and an idea how the `createTestPlans`-function can be used.

import { createTestPlans, StatesTestFunctions } from '@smartive/xstate-test-toolbox';
import { FetchInterceptor, mockHeaders, mockResponse, RequestCallCountMock } from '@smartive/testcafe-utils';
import { TestEventsConfig } from '@xstate/test/lib/types';
import { RequestMock } from 'testcafe';
import { Context, machine } from './machine-under-test';
// ...

type TestContext = {
  t: TestController,
  plan: string,
  path: string
};

const fetchInterceptor = new FetchInterceptor({
  fetchPeople: /.+swapi\.dev.+\/people\/$/,
  fetchMore: /.+swapi\.dev.+\/people\/\?page=.+/,
  searchPeople: /.+swapi\.dev.+\/people\/\?search=.+/,
});

const getRequestMocks = (plan: string, path: string): object[] => {
  const peopleUrl = /.+swapi\.dev.+\/people\/.*/
  if (
    plan.includes('NoResults') ||
    (plan.includes('Searching') && path.includes('NoResults'))
  ) {
    return [
      RequestMock()
        .onRequestTo(peopleUrl)
        .respond(empty, 200, mockHeaders),
    ];
  }

  if (plan.includes('Error')) {
    switch (path) {
      case 'Pending → error.platform.fetchPeople':
        return [
          RequestMock().onRequestTo(peopleUrl).respond({}, 400, mockHeaders),
        ];
      case 'Pending → done.invoke.fetchPeople → Idle → END_REACHED → LoadingMore → error.platform.fetchMore':
        return [
          new RequestCallCountMock(peopleUrl, [
            { body: mockResponse(peoples) },
            { body: mockResponse({}, 400) },
          ]),
        ];
      case 'Pending → done.invoke.fetchPeople → NoResults → QUERY_DISPATCHED → Searching → error.platform.searchPeople':
        return [
          RequestMock()
            .onRequestTo(fetchInterceptor.interceptUrls.searchPeople)
            .respond({}, 400, mockHeaders),
          RequestMock()
            .onRequestTo(peopleUrl)
            .respond(empty, 200, mockHeaders),
        ];
      case 'Pending → done.invoke.fetchPeople → Idle → QUERY_DISPATCHED → Searching → error.platform.searchPeople':
        return [
          RequestMock()
            .onRequestTo(fetchInterceptor.interceptUrls.searchPeople)
            .respond({}, 400, mockHeaders),
        ];
    }
  }

  return [];
};

const tests: StatesTestFunctions<Context, TestContext> = {
  Pending: ({ t }) => t.expect(page.spinner.exists).ok(),
  Idle: ({ t }) => t.expect(page.listItem.count).gt(0),
  LoadingMore: ({ t }) => t.expect(page.listItem.count).gt(1).expect(page.spinner.exists).ok(),
  Error: ({ t }) => t.expect(page.error.exists).ok(),
  NoResults: ({ t }) => t.expect(page.notify.exists).ok(),
  Searching: ({ t }) => t.expect(page.search.value).contains('luke').expect(page.spinner.exists).ok(),
};

const testEvents: TestEventsConfig<TestContext> = {
  END_REACHED: ({ t }) => t.hover(page.listItem.nth(9), { speed: 0.8 }),
  QUERY_DISPATCHED: ({ t }) => t.typeText(page.search, 'luke', { speed: 0.8 }),
  'done.invoke.fetchPeople': fetchInterceptor.resolve('fetchPeople'),
  'error.platform.fetchPeople': fetchInterceptor.resolve('fetchPeople'),
  'error.platform.fetchMore': fetchInterceptor.resolve('fetchMore'),
  'error.platform.searchPeople': fetchInterceptor.resolve('searchPeople'),
};

createTestPlans({
  machine,
  tests,
  testEvents,
  // add logLevel: LogLevel.INFO for some output which plans/paths are generated
}).forEach(
  ({ description: plan, paths }) => {
    fixture(plan).page(`http://localhost:3000/peoples`);

    paths.forEach(({ test: run, description: path }) => {
      test
        .clientScripts([fetchInterceptor.clientScript()])
        .requestHooks(getRequestMocks(plan, path))(`via ${path} ⬏`, (t) => run({ plan, path, t }));
    });
  }
);
```
