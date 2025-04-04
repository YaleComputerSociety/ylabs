import app from "./app";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const port = process.env.PORT || 4000;
const mongoUri = (process.env.MONGODBURL_TEST && (process.env.API_MODE == 'test')) ? process.env.MONGODBURL_TEST : process.env.MONGODBURL;

console.log('MongoDB URI:', mongoUri);
console.log('API Mode:', process.env.API_MODE);

const startApp = async () => {
  try {
    console.log('Attempting to connect to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('Successfully connected to MongoDB!');
    app.listen(port, () => {
      console.log(`Server is ready at: ${port} 🐶`);
      if (process.env.MONGODBURL_TEST && (process.env.API_MODE == 'test')) {
        console.log("Using test MongoDB database 🔬")
      } else {
        console.log("Using production MongoDB database 🚀")
      }
    });
  } catch (e) {
    console.error(`Failed to start app with error 💣: ${e}`);
  }
};

startApp();