import csv
import requests
import time

#Adds users to the mongo users colleciton using the post route hosted on the local server
def addUsers(filename, serverURL, verbose = False, batchSize = 50):
    #prints and sets starting conditions if console updates are requested
    if verbose:
        print("Beginning user writing")
        start = time.time()
        lap = time.time()

        #gets total number of listings to classify
        with open(filename, 'r') as file:
            reader = csv.reader(file)
            listingsLength  = sum(1 for row in reader) 

    with open(filename, 'r') as file:
            reader = csv.reader(file)

            for index, row in enumerate(reader):
                try:
                    if verbose & (index % batchSize == 0) & (index > 0):
                        print(f'{index} of {listingsLength}, {round(index/listingsLength*100, 2)}%; batch time: {time.time() - lap}; total time: {time.time() - start}')
                        lap = time.time()
                    if row[0] != "name":
                        netid = row[1]
                        email = row[3]
                        fname = row[0].split(" ")[0]
                        lname = " ".join(row[0].split(" ")[1:])
                        departments = [row[10]]

                        user = {
                            "netid": netid,
                            "email": email,
                            "isProfessor": True,
                            "fname": fname,
                            "lname": lname,
                            "departments": departments
                        }

                        response = requests.post(serverURL, json = user)
                        
                        if(response.status_code != 200):
                             print(f"Error in posting users: {response.text}")
                             if(input("Continue? ").lower() != "y"):
                                break
                except Exception as e:
                     print(f"Python exception occurred in posting users: {e}")
                     break