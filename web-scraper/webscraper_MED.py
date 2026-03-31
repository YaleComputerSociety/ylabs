import requests
from bs4 import BeautifulSoup
import time
import json

BASE_URL = "https://medicine.yale.edu"
URL = "https://medicine.yale.edu/about/a-to-z-index/atoz/lab-websites/"

headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/118.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
}

def get_soup(url):
    try:
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        return BeautifulSoup(response.text, "html.parser")
    except Exception as e:
        print(f"Error fetching {url}: {e}")
        return None

print("Scraping Yale Medicine Lab Directory...")
soup = get_soup(URL)
if soup is None:
    raise RuntimeError("Failed to load A–Z page")

lab_links = []

# --- STEP 1: Extract lab links from table rows ---
# The A-to-Z page has a table with two columns: Lab Name | URL
table = soup.find("table")
if not table:
    print("Warning: no <table> found on the A–Z page. Inspecting HTML…")
else:
    for row in table.find_all("tr"):
        cols = row.find_all("td")
        # Expect two columns: name and link
        if len(cols) >= 2:
            name = cols[0].get_text(strip=True)
            link_tag = cols[1].find("a", href=True)
            if link_tag:
                href = link_tag["href"]
                # Fix relative path
                if href.startswith("/"):
                    href = BASE_URL + href
                lab_links.append({
                    "lab_name": name,
                    "url": href
                })

print(f"Found {len(lab_links)} labs.")

def find_publications_page(lab_url):
    soup = get_soup(lab_url)
    if not soup:
        return None
    
    # look for nav links
    nav_links = soup.find_all("a", href=True)

    pub_keywords = ["publication", "publications", "papers", "selected", "articles"]

    for a in nav_links:
        text = a.get_text(strip=True).lower()
        href = a["href"]

        if any(k in text for k in pub_keywords):
            # fix relative URL
            if href.startswith("/"):
                return BASE_URL + href
            elif href.startswith("http"):
                return href
            else:
                # relative to current lab site
                return lab_url.rstrip("/") + "/" + href

    return None


def scrape_publications(pub_url):
    if not pub_url:
        return None

    soup = get_soup(pub_url)
    if not soup:
        return None

    # Try extracting lists (common format)
    list_items = soup.find_all("li")
    if list_items:
        pubs = [li.get_text(separator=" ", strip=True) for li in list_items]
        if pubs:
            return pubs

    # fallback: paragraph blocks
    ps = soup.find_all("p")
    if ps:
        pubs = [p.get_text(separator=" ", strip=True) for p in ps]
        if pubs:
            return pubs

    # fallback: general text
    text = soup.get_text(separator=" ", strip=True)
    return text[:5000]  # safety cut-off


# --- STEP 2: Scrape each lab for research bio ---
def extract_lab_bio(lab_url):
    soup = get_soup(lab_url)
    if not soup:
        return None

    # potential containers for research narrative
    selectors = [
        ("div", "wysiwyg"),
        ("div", "field-item"),
        ("div", "field-item even"),
        ("section", "research"),
    ]
    for tag, cls in selectors:
        el = soup.find(tag, class_=cls)
        if el:
            return el.get_text(separator=" ", strip=True)

    # fallback: join big paragraphs
    ps = soup.find_all("p")
    if len(ps) >= 3:
        return " ".join(p.get_text(strip=True) for p in ps)

    return None

output = []
for i, lab in enumerate(lab_links, start=1):
    print(f"Scraping lab {i}/{len(lab_links)}: {lab['lab_name']} — {lab['url']}")

    # research page scrape
    bio = extract_lab_bio(lab["url"])

    # publications page scrape
    pub_page = find_publications_page(lab["url"])
    publications = scrape_publications(pub_page)

    output.append({
        "lab_name": lab["lab_name"],
        "lab_url": lab["url"],
        "research_bio": bio,
        "publications_page": pub_page,
        "publications": publications
    })

    time.sleep(0.5)


# --- Save to JSON ---
with open("yale_medicine_labs.json", "w", encoding="utf-8") as f:
    json.dump(output, f, indent=2, ensure_ascii=False)

print("Saved yale_medicine_labs.json")
