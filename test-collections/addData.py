import requests;

baseUrl = "http://localhost:4000"

def addUsers(users):
    postUrl = baseUrl + "/users"

    for user in users:
        try:
            response = requests.post(postUrl, json = user)
            response.raise_for_status()
            print("Added user:", response.json())
        except requests.exceptions.RequestException as error:
            print("Error:", error)
            break

def addUserBackups(users):
    postUrl = baseUrl + "/userBackups"

    for user in users:
        try:
            response = requests.post(postUrl, json = user)
            response.raise_for_status()
            print("Added user backup:", response.json())
        except requests.exceptions.RequestException as error:
            print("Error:", error)
            break

def addListings(listings):
    postUrl = baseUrl + "/listings"

    for listing in listings:
        try:
            response = requests.post(postUrl, json = listing)
            response.raise_for_status()
            print("Added user backup:", response.json())
        except requests.exceptions.RequestException as error:
            print("Error:", error)
            break