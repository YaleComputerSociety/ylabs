import requests
from bs4 import BeautifulSoup
import time
import json
from urllib.parse import urljoin

BASE_URL = "https://history.yale.edu"
FACULTY_URL = "https://history.yale.edu/people/faculty"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/118.0.0.0 Safari/537.36"
    )
}

# Fetch HTML & parse
def get_soup(url):
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        r.raise_for_status()
        return BeautifulSoup(r.text, "html.parser")
    except Exception as e:
        print(f"Error fetching {url}: {e}")
        return None

def get_faculty_list():
    faculty = []
    page = 0

    while True:
        url = f"{FACULTY_URL}?page={page}"
        print("Loading list page:", url)

        soup = get_soup(url)
        if not soup:
            break

        rows = soup.select("table.views-table tbody tr")
        if not rows:
            break  # No more pages

        for row in rows:
            # Name + profile URL
            name_link = row.select_one("td.views-field-name a")
            if not name_link:
                continue

            name = name_link.get_text(strip=True)
            profile_url = urljoin(BASE_URL, name_link["href"])

            # Fields of interest
            interest_cell = row.select_one(
                "td.views-field-field-field-s-of-interest"
            )
            fields_of_interest = (
                interest_cell.get_text(" ", strip=True)
                if interest_cell
                else None
            )

            faculty.append({
                "name": name,
                "profile_url": profile_url,
                "fields_of_interest": fields_of_interest
            })

        page += 1
        time.sleep(0.5)

    return faculty

# Extract full bio
def extract_full_bio(profile_url):
    soup = get_soup(profile_url)
    if not soup:
        return None

    # Find the bio section - it's in a div with a label "Bio:"
    bio_parts = []
    
    # Look for all field items in the main content area
    # The bio appears after the "Bio:" label in the field content
    labels = soup.find_all("div", class_="field-label")
    
    for label in labels:
        if label.get_text(strip=True) == "Bio:":
            # Get the next sibling which should be the field-items div
            field_items = label.find_next_sibling("div", class_="field-items")
            if field_items:
                # Extract all text, preserving paragraph breaks
                paragraphs = field_items.find_all("p")
                if paragraphs:
                    for p in paragraphs:
                        text = p.get_text(strip=True)
                        if text:
                            bio_parts.append(text)
                else:
                    # If no paragraphs, just get all text
                    text = field_items.get_text(strip=True)
                    if text:
                        bio_parts.append(text)
                break
    
    # Also check for publications and awards if present
    publications = []
    for label in soup.find_all("strong"):
        if "Publications" in label.get_text():
            parent = label.find_parent()
            if parent:
                items = parent.find_all("li")
                for item in items:
                    publications.append(item.get_text(strip=True))
    
    # Join bio parts
    bio_text = "\n\n".join(bio_parts) if bio_parts else None
    
    return bio_text
# Scrape all faculty
def scrape_all():
    faculty = get_faculty_list()
    print(f"Found {len(faculty)} faculty")

    results = []

    for i, person in enumerate(faculty, 1):
        print(f"[{i}/{len(faculty)}] Scraping {person['name']}")
        bio = extract_full_bio(person["profile_url"])

        results.append({
            "name": person["name"],
            "department": "History",
            "profile_url": person["profile_url"],
            "fields_of_interest": person["fields_of_interest"],
            "bio": bio
        })

        time.sleep(0.5)  # polite scraping

    with open("yale_history_faculty.json", "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    print(f"Saved yale_history_faculty.json with {len(results)} faculty members")

if __name__ == "__main__":
    scrape_all()