# YURA Research Database

The site is live [here](https://rdb.onrender.com). 

### Running Locally

Prereqs:
- Node v16.20 
- Yarn 

#### For development

Run `yarn install:all` to install relevant npm packages. Rename the .env.example files in the client and server directories to .env, and fill in the relevant fields. To launch the client, open a terminal and run `yarn dev:client`. To launch the server, open a separate terminal and run `yarn dev:server`. The client is served on port 3000, and the REST API is run on port 4000. Go to `http://localhost:3000` in your browser to view the application.

#### For testing

Run `yarn test` or `yarn install:all && yarn build && yarn start`. Go to `http://localhost:3000` in your browser to view the application.

### Acknowledgements

Thanks @wu-json for creating a CAS authentication [demo](https://github.com/yale-swe/cas-auth-example-express/tree/main)!