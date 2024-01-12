"""
Given updates.csv, creates a updates.json file 
After the json is created:
1. Install mongoimport (https://www.mongodb.com/docs/database-tools/installation/installation-macos/)
2. run the following command in terminal: mongoimport --uri 'mongodb+srv://rdbtest.hcn3xyq.mongodb.net/RDB?retryWrites=true&w=majority' --username='yura' --collection='listings' --file='updates.json' --jsonArray --mode=upsert
  2.1. Need to get password from julian.lee@yale.edu
"""

import csv
import json

csvFilePath = 'updates.csv'
jsonFilePath = 'updates.json'
     
data = []

department_names = {}
with open("valid_departments.txt", 'r') as f:
  department_names = [line.rstrip('\n') for line in f]
  department_names = set(department_names)
print(department_names)
  
# Open a csv reader called DictReader
with open(csvFilePath, encoding='utf-8') as csvf:
  csvReader = csv.DictReader(csvf)

  i = 0
  for row in csvReader:
    i += 1

    #Split names 
    if row['name'].find(', ') != -1:
      #In format Smith, John
      row['lname'] = row['name'][0:row['name'].find(', ')]
      row['fname'] = row['name'][row['name'].find(', ') + 2:]
    else:
      #In format John Smith
      row['fname'] = row['name'][0:row['name'].find(' ')]
      row['lname'] = row['name'][row['name'].find(' ') + 1:]

    #Split departments into a list
    curr_departments = []
    for department in department_names:
      raw_department = department
      department = department.lower()
      row['departments'] = row['departments'].lower().replace('&','and')
      if row['departments'].find(department) != -1:
        curr_departments.append(raw_department)
    if len(curr_departments) == 0:
      print(f"failed to extract a department from {row['departments']}")
    row['departments'] = curr_departments

    del row['name']
    del row['custom_desc']
    row['_id'] = row['list_id']
    del row['list_id']

    data.append(row)

# Open a json writer, and use the json.dumps() 
# function to dump data
with open(jsonFilePath, 'w', encoding='utf-8') as jsonf:
  jsonf.write(json.dumps(data, indent=4))