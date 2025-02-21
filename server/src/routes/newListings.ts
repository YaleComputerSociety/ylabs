import { NewListing } from '../models';
import { Request, Response, Router } from "express";

const router = Router();



/* Route for getting relevant listings based on the queries fname, lname, and dept (all optional, at least one of the 3 must be provided)
fname: fname must be a substring of prof's first name for the corresponding listing to be included
lname: lname must be a substring of prof's last name for the corresponding listing to be included
dept: dept must contain a department mentioned in the listing for the corresponding listing to be included
*/

//Need to update this route later for proper search behavior

/*router.get('/', async (request: Request, response: Response) => {
  try {
    const fname = request.query.fname === undefined ? '' : request.query.fname;
    const lname = request.query.lname === undefined ? '' : request.query.lname;
    const keywords = request.query.keywords === undefined ? '' :  (request.query.keywords as String).replace(',', ' ').replace('  ', ' ');
    const dept = request.query.dept === undefined || request.query.dept === '' ? [] : (request.query.dept as String).split(',');

    if(fname === '' && lname === '' && dept.length == 0 && keywords.length == 0){
      throw new Error('At least 1 query must be provided');
    } 

    let query = { "fname": { "$regex": fname, "$options": "i" }, 
                  "lname": { "$regex": lname, "$options": "i" },
                  "departments": { "$elemMatch": { "$in": dept } },
                  "$text": { "$search": keywords, "$caseSensitive": false }};

    if(dept.length === 0){
      delete query["departments"];
    }
    if(keywords == ''){
      delete query["$text"];
    }
    
    const listings = await Listing.find(query);
    return response.status(200).json(listings);

  } catch (error) {
    console.log(error.message);
    response.status(500).send({ message: error.message });
  }
});
*/

export default router;