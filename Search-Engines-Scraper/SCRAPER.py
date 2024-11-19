import csv
import requests
import http.client
from urllib.parse import urlparse
from search_engines import Aol, Duckduckgo, Yahoo, Google, Bing
#


def readTXT(filename):
    """Extracts URLs from the provided filename and returns them in a list."""
    with open(filename, 'r') as file:
        contents = file.read().splitlines()

    urls = []
    for line in contents[1:]:
        if ';' in line:
            url = line.split(';')[1]
            domain = url.split("//")[1].split("/")[0]
            urls.append(domain)

    return urls


def generate_queries(filename):
    """Generate search queries in the format 'First Name Last Name Title Yale'."""
    queries = []
    with open(filename, 'r') as file:
        reader = csv.reader(file)
        next(reader)  # Skip the header row

        for row in reader:
            full_name = row[0].strip('"')
            first_name, last_name = full_name.split(", ")[1], full_name.split(", ")[0]
            title = row[2]
            query = f"{first_name} {last_name} {title} Yale"
            queries.append(query)

    return queries


def load_existing_profiles(filename='profiles.csv'):
    """Load existing profiles from CSV to avoid duplicate searches."""
    existing_profiles = {}
    try:
        with open(filename, mode='r', newline='') as file:
            reader = csv.DictReader(file)
            for row in reader:
                existing_profiles[row['Query']] = row['Profile URL']
        return existing_profiles
    except FileNotFoundError:
        return {}


def append_to_profiles_csv(profile_url, query, filename='profiles.csv'):
    """Append a new profile to the CSV file."""
    file_exists = True
    try:
        with open(filename, 'r'):
            pass
    except FileNotFoundError:
        file_exists = False

    with open(filename, mode='a', newline='') as file:
        writer = csv.writer(file)
        if not file_exists:
            writer.writerow(["Profile URL", "Query"])  # Write header if file is new
        writer.writerow([profile_url, query])


def main():
    # Initialize
    url_list = readTXT('Departments.txt')
    queries = generate_queries('professors_details.csv')
    existing_profiles = load_existing_profiles()

    # Process queries
    for q in queries:
        search_query = q + " Profile"

        # Skip if already processed
        if search_query in existing_profiles:
            print(f"Skipping already processed query: {search_query}")
            continue

        print(f"Processing query: {search_query}")
        engine = Yahoo()
        results = engine.search(search_query)
        links = results.links()

        for link in links:
            domain = urlparse(link).netloc
            if 'yale.edu' in domain:
                append_to_profiles_csv(link, search_query)
                print(f"Found and saved profile for: {search_query}")
                break


if __name__ == "__main__":
    main()