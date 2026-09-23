import axios from 'axios';
import {
  readCourseCreditRouteFromHtml,
  readCourseCreditRoutePage,
} from './src/scrapers/utils/courseCreditRouteEvidence';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const SEEDS: Array<[string, string]> = [
  ['psychology', 'https://psychology.yale.edu/what-directed-research-course'],
  ['history', 'https://history.yale.edu/undergraduate/senior-essay'],
  ['english-language-and-literature', 'https://english.yale.edu/undergraduate/senior-essay'],
  ['molecular-cellular-and-developmental-biology', 'https://mcdb.yale.edu/undergraduate/undergrad-degree-programs'],
  ['molecular-biophysics-and-biochemistry', 'https://mbb.yale.edu/undergraduate-education/programs-study-requirements'],
  ['chemistry', 'https://chem.yale.edu/academics/undergraduate-chemistry-at-yale/independent-research-opportunities'],
  ['astronomy-and-astrophysics', 'https://astronomy.yale.edu/undergraduate-program/guidelines-senior-projects-astronomy-ba-and-astrophysics-bs-majors'],
  ['economics', 'https://economics.yale.edu/undergraduate/senior-essay'],
  ['american-studies', 'https://americanstudies.yale.edu/undergraduate-program/senior-year/senior-essay-course-requirements'],
  ['women-gender-and-sexuality-studies', 'https://wgss.yale.edu/undergraduate-program/requirements-wgss-major'],
  ['linguistics', 'https://ling.yale.edu/undergraduate-studies/program-requirements'],
  ['history-of-science-and-medicine', 'https://hshm.yale.edu/undergraduate-major/senior-project'],
  ['statistics-and-data-science', 'https://statistics.yale.edu/undergraduates/the-major/49104920-senior-essay'],
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let accepted = 0;
  let refused = 0;
  for (const [slug, url] of SEEDS) {
    try {
      const res = await axios.get(url, { timeout: 30000, headers: { 'User-Agent': UA }, maxRedirects: 5 });
      const html = res.data as string;
      const reading = readCourseCreditRouteFromHtml(html, res.request?.res?.responseUrl || url);
      const pageLen = readCourseCreditRoutePage(html).body.length;
      const loose = 0;
      if (reading) {
        accepted += 1;
        console.log(`ACCEPT ${slug} (page ${pageLen} chars, ${reading.supportingQuoteCount} supporting)`);
        console.log(`   "${reading.evidenceQuote.slice(0, 160)}"`);
      } else {
        refused += 1;
        console.log(`REFUSE ${slug} (page ${pageLen} chars, ${loose} candidate sentences)`);
      }
    } catch (e: any) {
      refused += 1;
      console.log(`ERROR  ${slug}: ${e?.message}`);
    }
    await sleep(2000);
  }
  console.log(`\naccepted ${accepted} of ${SEEDS.length}, refused ${refused}`);
}
main();
