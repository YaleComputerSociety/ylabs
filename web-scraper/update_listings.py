import csv
import os
from bs4 import BeautifulSoup
from base_scraper import getDetailedListings
import time

listings = getDetailedListings('a', 'z')

with open('raw_listings_initial.csv', 'w', newline = '') as file:
    writer = csv.writer(file)
    fields = ['name', 'id', 'title', 'email', 'upi', 'unit', 'department', 'location', 'building', 'mailing']

    writer.writerow(fields)

    for listing in listings:
        soup = BeautifulSoup(str(listing), 'html.parser')

        name = soup.find('span', id = 'bps-final-name').text
        id = soup.find('span', id = 'bps-final-netid').text
        title = soup.find('p', id = 'bps-final-title').text
        email = soup.find('a', id = 'bps-final-email-anchor').text
        upi = soup.find('p', id = 'bps-final-upi').text
        unit = soup.find('p', id = 'bps-final-org').text
        department = soup.find('p', id = 'bps-final-org-unit').text
        location = soup.find('p', id = 'bps-final-office-addr').text
        building = soup.find('p', id = 'bps-final-location').text
        mailing = soup.find('p', id = 'bps-final-mailing-addr').text

        writer.writerow([name, id, title, email, upi, unit, department, location, building, mailing])

with open('raw_listings_initial.csv', 'r') as input, open('raw_listings.csv', 'w') as output:
    writer = csv.writer(output)
    for row in csv.reader(input):
        if row[0] != "":
            writer.writerow(row) 

os.remove('raw_listings_initial.csv') 