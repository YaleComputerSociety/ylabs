"""
Given updates.csv, creates a updates.json file 
After the json is created:
1. Install mongoimport (https://www.mongodb.com/docs/database-tools/installation/installation-macos/)
2. run the following command in terminal: mongoimport --uri 'mongodb+srv://rdbtest.hcn3xyq.mongodb.net/RDB?retryWrites=true&w=majority' --username='yura' --collection='profListings' --file='professor_updates.json' --jsonArray --mode=upsert
  2.1. Need to get password from julian.lee@yale.edu
"""

import csv
import json

csvFilePath = 'professor_listings.csv'
jsonFilePath = 'professor_updates.json'
     
data = []

# Open a csv reader called DictReader
with open(csvFilePath, encoding='utf-8') as csvf:
  csvReader = csv.DictReader(csvf)

  for row in csvReader:
    prof = row

    # save info
    prof['fname'] = row['name'][0:row['name'].find(' ')]
    prof['lname'] = row['name'][row['name'].find(' ') + 1:]

    del prof['name']

    # attributes of prof: fname lname	id	title	email	upi	unit	department	location	building	mailing

    data.append(prof)

# Open a json writer, and use the json.dumps() 
# function to dump data
with open(jsonFilePath, 'w', encoding='utf-8') as jsonf:
  jsonf.write(json.dumps(data, indent=4))