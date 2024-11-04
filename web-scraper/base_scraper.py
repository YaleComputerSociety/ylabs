"""
Scrapes the yale directory website in order to find information about all listed professors
Eventually will create default RDB listings for all professors on the directory website
"""

import requests
import time
from selenium import webdriver
from bs4 import BeautifulSoup
from selenium.webdriver.common.by import By
from string import ascii_lowercase

DIRECTORY_URL = "https://directory.yale.edu"
BASE_URL = "https://directory.yale.edu/?queryType=field&title=Professor&lastname="
DETAILED_URL = "https://directory.yale.edu/?queryType=term&pattern="
CAS_URL = "https://secure6.its.yale.edu/cas/login"

driver = webdriver.Chrome()

#Manual authentication function is kinda bare bones, can definitely be improved in future, but works for now
def manualAuthentication(maxSearchDuration = 3):
    driver.get(CAS_URL)
    input('Please login to CAS on the browser tab. Press enter when finished: ')

    #Check authentification
    searchDuration = 0
    driver.get(DIRECTORY_URL)

    while((getSoup(driver.page_source).find(id = 'bps-login') == None)  & (searchDuration < maxSearchDuration)):
        time.sleep(0.1)
        searchDuration += 0.1

    button = driver.find_element(By.ID, 'bps-login')
    button.click()

    time.sleep(maxSearchDuration)

    soup = getSoup(driver.page_source)

    if (soup.find(id = 'bps-login') != None) & (soup.find(id = 'bps-login').text == "LOG OUT"):
        return True
    else:
        return False

def getURL(lastName):
    return BASE_URL + lastName

def getDetailedURL(name):
    return DETAILED_URL + name

def getSite(lastName, maxSearchDuration = 3):
    driver.get(getURL(lastName))
    searchDuration = 0

    while(((getSoup(driver.page_source).find(id = 'loading-indicator') == None) | ('inline' in getSoup(driver.page_source).find(id = 'loading-indicator')['style'])) & (searchDuration < maxSearchDuration)):
        time.sleep(0.1)
        searchDuration += 0.1

    return driver.page_source

def getDetailedSite(name, maxSearchDuration = 3):
    driver.get(getDetailedURL(name))
    searchDuration = 0

    while(((getSoup(driver.page_source).find(id = 'loading-indicator') == None) | ('inline' in getSoup(driver.page_source).find(id = 'loading-indicator')['style'])) & (searchDuration < maxSearchDuration)):
        time.sleep(0.1)
        searchDuration += 0.1

    return driver.page_source

def getSoup(site):
    return BeautifulSoup(site, 'html.parser')

def addListings(listings, nameStr = '', startChar = 'a', endChar = 'z', display = False, detailed = False):
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
            addListings(listings = listings, nameStr = nameStr + c, detailed = detailed)
        else:
            if(detailed & (numResults > 1)):
                #articles = driver.find_elements(By.TAG_NAME, 'article')
                results = driver.find_elements(By.CLASS_NAME, 'directory_item')
                for result in results[0:numResults]:
                    linkText = result.find_element(By.CLASS_NAME, 'bps-result-name').text
                    link = result.find_element(By.LINK_TEXT, linkText)
                    listings.append(subListing(link))
            else:
                listings.extend(soup.find_all("article", class_ = "directory_item")[0:numResults])

def subListing(link, maxSearchDuration = 3):
    link.click()
    searchDuration = 0

    while(((getSoup(driver.page_source).find(id = 'loading-indicator') == None) | ('inline' in getSoup(driver.page_source).find(id = 'loading-indicator')['style'])) & (searchDuration < maxSearchDuration)):
        time.sleep(0.1)
        searchDuration += 0.1
    
    soup = getSoup(driver.page_source)

    driver.find_element(By.CLASS_NAME, 'go-back').click()

    return soup.find("article", id = "bpa-final-result-article")

def getListings(startChar = 'a', endChar = 'z', display = False, detailed = True):
    listings = []
    addListings(listings = listings, startChar = startChar, endChar = endChar, display = display, detailed = detailed)

    return listings

def getDetailedListings(startChar = 'a', endChar = 'z', display = False):
    if(manualAuthentication()):
        return getListings(startChar = startChar, endChar = endChar, display = False, detailed = True)