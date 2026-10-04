export const IDLE_SEARCH_BUTTON_NAME = 'Search';
export const SEARCH_INPUT_LABEL = 'Search y/labs';
const SEARCH_RESULTS_SELECTOR = 'section[aria-label="Search results"]';

export const accessibleNameFromAriaSnapshot = (snapshot) => {
  const match = /^-\s+button\s+"((?:[^"\\]|\\.)*)"/.exec(String(snapshot ?? '').trim());
  return match ? JSON.parse(`"${match[1]}"`) : null;
};

export const stuckSearchProblems = ({ buttonName, buttonDisabled, resultsBusy }) => {
  const problems = [];
  if ((buttonName ?? '').trim().toLowerCase() !== IDLE_SEARCH_BUTTON_NAME.toLowerCase()) {
    problems.push(
      `Search button is stuck in its loading state: its accessible name is ${JSON.stringify(buttonName)}, not "${IDLE_SEARCH_BUTTON_NAME}".`,
    );
  }
  if (buttonDisabled) {
    problems.push('Search button remained disabled after results loaded.');
  }
  if (resultsBusy !== 'false') {
    problems.push(
      `Search results never settled out of the loading state (aria-busy is ${JSON.stringify(resultsBusy)}).`,
    );
  }
  return problems;
};

export const searchSubmitButton = (page) =>
  page
    .locator('form')
    .filter({ has: page.getByLabel(SEARCH_INPUT_LABEL) })
    .locator('button[type="submit"]');

export const waitForSearchResultsToSettle = (page, timeout) =>
  page.locator(`${SEARCH_RESULTS_SELECTOR}[aria-busy="false"]`).waitFor({ timeout });

export const readSearchState = async (page) => {
  const button = searchSubmitButton(page);
  await button.waitFor({ timeout: 20000 });
  return {
    buttonName: accessibleNameFromAriaSnapshot(await button.ariaSnapshot()),
    buttonDisabled: await button.isDisabled(),
    resultsBusy: await page.locator(SEARCH_RESULTS_SELECTOR).getAttribute('aria-busy'),
  };
};
