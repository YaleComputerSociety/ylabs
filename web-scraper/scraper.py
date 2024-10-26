"""
Scrapes the yale directory website in order to find information about all listed professors
Eventually will create default RDB listings for all professors on the directory website
"""

import requests
import time
from selenium import webdriver
from bs4 import BeautifulSoup
from string import ascii_lowercase

BASE_URL = "https://directory.yale.edu/?queryType=field&title=Professor&lastname="

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

def addListings(listings, nameStr = '', numLetters = 26):
    for c in ascii_lowercase[0:numLetters]:
        soup = getSoup(getSite(nameStr + c))

        resultsText = soup.find(id = 'results-people-header').text 

        numResults = int(resultsText.split(' ')[0]) if resultsText.split(' ')[0].isdigit() else 1 if 'display: none' in soup.find(id = 'bps-result-region')['style'].split(';') else 0

        #Temp display
        if(numResults == 25):
            print(f'Searching "{nameStr + c}"... Found {numResults} results')

        surplusResults = numResults != 1 and 'display: block' in soup.find(id = 'bps-result-region').find('div', class_ = 'directory_results_warning')['style'].split(';')

        #Handle surplus results
        if(surplusResults):
            addListings(listings, nameStr + c)
        else:
            listings.extend("listing" for i in range(numResults))

#Finds all "a" listings
myListings = []
addListings(myListings, numLetters = 1)
print(len(myListings))