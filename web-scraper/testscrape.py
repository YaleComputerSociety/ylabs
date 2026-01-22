import requests
from bs4 import BeautifulSoup
import time
import json

url = "https://physics.yale.edu/people"
response = requests.get(url)
soup = BeautifulSoup(response.text, "html.parser")

faculty_data = []
count = 0

# Loop through each table row containing a listing
for row in soup.find_all("tr"):
    name_cell = row.find("td", class_="views-field-name")
    if not name_cell:
        continue  # Skip rows without a listing
    
    # --- Name & profile link ---
    name_tag = name_cell.find("a", class_="username")
    name = name_tag.get_text(strip=True) if name_tag else None
    profile_link = f"https://physics.yale.edu{name_tag['href']}" if name_tag else None
    
    # --- Text content ---
    text_parts = list(name_cell.stripped_strings)
    # First entry is name
    title = text_parts[1] if len(text_parts) > 1 else None
    office = text_parts[2] if len(text_parts) > 2 else None
    
    # --- Email ---
    email_tag = name_cell.find("a", href=lambda x: x and x.startswith("mailto:"))
    email = email_tag.get_text(strip=True) if email_tag else None
    
    # --- Website ---
    website_tag = name_cell.find("a", href=lambda x: x and x.startswith("http"))
    website = website_tag['href'] if website_tag else None
    
    # --- Phone numbers ---
    phones = []
    for t in text_parts:
        # Match typical phone patterns
        if "Phone:" in t or t.replace("-", "").strip().isdigit():
            phones.append(t.replace("Phone:", "").strip())
    
    # --- Picture ---
    pic_cell = row.find("td", class_="views-field-picture")
    img_tag = pic_cell.find("img") if pic_cell else None
    image_url = img_tag['src'] if img_tag else None
    
    # --- Field of study ---
    study_cell = row.find("td", class_="views-field-field-field-of-study")
    field_of_study = study_cell.get_text(strip=True) if study_cell else None
    
    count += 1
    
    # --- Scrape profile page for bio text ---
    profile_bio = None
    if profile_link:
        try:
            print(f"Scraping profile page {count}: {name} - {profile_link}...")
            profile_response = requests.get(profile_link, timeout=10)
            profile_soup = BeautifulSoup(profile_response.text, "html.parser")
            
            # Look for the research narrative field
            research_field = profile_soup.find("div", class_="field-name-field-research-narrative")
            if research_field:
                field_item = research_field.find("div", class_="field-item even")
                if field_item:
                    profile_bio = field_item.get_text(separator=" ", strip=True)
            
            time.sleep(0.5)
        except Exception as e:
            print(f"Error scraping profile page {profile_link}: {e}")
            profile_bio = None
    
    # --- Scrape external website for research/bio text ---
    website_text = None
    if website:
        try:
            print(f"Scraping website {count}: {name} - {website}...")
            website_response = requests.get(website, timeout=10)
            website_soup = BeautifulSoup(website_response.text, "html.parser")
            
            # Extract text from the specific div with class "field-item even"
            field_item = website_soup.find("div", class_="field-item even")
            if field_item:
                website_text = field_item.get_text(separator=" ", strip=True)
            else:
                # Fallback: try just "field-item" or "field-items"
                field_item = website_soup.find("div", class_="field-item")
                if field_item:
                    website_text = field_item.get_text(separator=" ", strip=True)
            
            # Optional: be respectful with rate limiting
            time.sleep(0.5)
        except Exception as e:
            print(f"Error scraping {website}: {e}")
            website_text = None
    else:
        print(f"No website found for {name}")
    
    faculty_data.append({
        "name": name,
        "profile_link": profile_link,
        "title": title,
        "office": office,
        "email": email,
        "phones": phones,
        "website": website,
        "image_url": image_url,
        "field_of_study": field_of_study,
        "profile_bio": profile_bio,
        "website_text": website_text
    })

# Save to JSON file
with open("faculty_data.json", "w", encoding="utf-8") as json_file:
    json.dump(faculty_data, json_file, indent=2, ensure_ascii=False)

print(f"\nData saved to faculty_data.json")
print(f"Total faculty members scraped: {len(faculty_data)}")