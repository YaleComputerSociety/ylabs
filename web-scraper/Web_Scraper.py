"""
Scrapes the yale directory website in order to find information about all listed professors
Eventually will create default RDB listings for all professors on the directory website
"""

import requests
import time
from selenium import webdriver
from bs4 import BeautifulSoup
from string import ascii_lowercase

BASE_URL = "https://physics.yale.edu/people"

driver = webdriver.Chrome()

def getURL(lastName):
    return BASE_URL + lastName

def getSite(lastName, maxSearchDuration = 3):
    driver.get(getURL(lastName))
    searchDuration = 0
    while(((getSoup(driver.page_source).find(id = 'loading-indicator') == None) | ('inline' in getSoup(driver.page_source).find(id = 'loading-indicator')['style'])) & (searchDuration < maxSearchDuration)):
        time.sleep(0.1)
        searchDuration += 0.1
    return driver.page_source

def getSoup(site):
    return BeautifulSoup(site, 'html.parser')

def addListings(listings, nameStr = '', startChar = 'a', endChar = 'c', display = False):
    for c in ascii_lowercase[ascii_lowercase.index(startChar):(ascii_lowercase.index(endChar) + 1)]:
        soup = getSoup(getSite(nameStr + c))

        resultsText = soup.find(id = 'results-people-header').text

        numResults = int(resultsText.split(' ')[0]) if resultsText.split(' ')[0].isdigit() else 1 if 'display: none' in soup.find(id = 'bps-result-region')['style'].split(';') else 0

        if(display):
            if(numResults == 25):
                print(f'Searching "{nameStr + c}"... Found {numResults} results')

        surplusResults = numResults != 1 and 'display: block' in soup.find(id = 'bps-result-region').find('div', class_ = 'directory_results_warning')['style'].split(';')

        #Handle surplus results
        if(surplusResults):
            addListings(listings = listings, nameStr = nameStr + c)
        else:
            listings.extend(soup.find_all("article", class_ = "directory_item")[0:numResults])

def getListings(startChar = 'a', endChar = 'z', display = False):
    listings = []
    addListings(listings = listings, startChar = startChar, endChar = endChar, display = display)
    return listings

import csv

def saveListingsToCSV(listings, filename='listings.csv'):
    with open(filename, mode='w', newline='', encoding='utf-8') as file:
        writer = csv.writer(file)
        writer.writerow(['Listing Name'])  # Header row
        for listing in listings:
            writer.writerow([listing])


# Collect listings
myListings = []
addListings(myListings)

# Save to CSV
saveListingsToCSV(myListings)

# Output the total number of listings found
print(f'Total listings found: {len(myListings)}')

# Close the Selenium driver
driver.quit()

#5620
