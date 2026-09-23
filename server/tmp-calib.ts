import axios from 'axios';
import { courseCreditRoutePageText } from './src/scrapers/utils/courseCreditRouteEvidence';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const SEEDS: Array<[string, string]> = [
  ['psychology', 'https://psychology.yale.edu/what-directed-research-course'],
  ['history', 'https://history.yale.edu/undergraduate/senior-essay'],
  ['mbb', 'https://mbb.yale.edu/undergraduate-education/programs-study-requirements'],
  ['astronomy', 'https://astronomy.yale.edu/undergraduate-program/guidelines-senior-projects-astronomy-ba-and-astrophysics-bs-majors'],
  ['american-studies', 'https://americanstudies.yale.edu/undergraduate-program/senior-year/senior-essay-course-requirements'],
  ['linguistics', 'https://ling.yale.edu/undergraduate-studies/program-requirements'],
  ['hshm', 'https://hshm.yale.edu/undergraduate-major/senior-project'],
  ['chemistry', 'https://chem.yale.edu/academics/undergraduate-chemistry-at-yale/independent-research-opportunities'],
];
const COURSE_TOKEN = /\b(?:directed research|independent study|senior (?:essay|thesis|project)|research course|research tutorial|for credit|course credit|academic credit|credit|[A-Z]{2,6}&?[A-Z]*\s?\d{3,4})\b/i;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  for (const [slug, url] of SEEDS) {
    try {
      const res = await axios.get(url, { timeout: 30000, headers: { 'User-Agent': UA }, maxRedirects: 5 });
      const text = courseCreditRoutePageText(res.data as string);
      const sentences = (text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || []).map((s) => s.replace(/\s+/g, ' ').trim());
      const hits = sentences.filter((s) => COURSE_TOKEN.test(s));
      console.log(`\n### ${slug} (${sentences.length} sentences, ${hits.length} with a course token)`);
      hits.slice(0, 4).forEach((s) => console.log(`   - ${s.slice(0, 230)}`));
      if (hits.length === 0) console.log(`   FULL TEXT: ${text.slice(0, 400)}`);
    } catch (e: any) {
      console.log(`\n### ${slug} ERROR ${e?.message}`);
    }
    await sleep(2000);
  }
}
main();
