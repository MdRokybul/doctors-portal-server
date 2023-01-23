const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require("stripe")('sk_test_51MShnWDwxGku0Y9cJkK38cRZQURUFYkKjLODU4Qie594lefThY0AWq7rc2MGz67k7ymU2kCtclCGG8Z2sqyMXie10045wnfdao');

const jwt = require('jsonwebtoken');
require('dotenv').config();
const app = express();
const port = 5000;

app.use(cors());
app.use(express.json());



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.xcfov6f.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send('Unauthorized access')
    }

    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: "Forbidden Access" });
        }
        req.decoded = decoded;
        next();
    })
}

async function run() {
    try {
        const appointmentOptionsCollection = client.db("doctorsPortaldb").collection("appointmentOptions");
        const bookingCollection = client.db("doctorsPortaldb").collection("bookings");
        const usersCollection = client.db("doctorsPortaldb").collection("users");
        const doctorsCollection = client.db("doctorsPortaldb").collection("doctors");
        const paymentsCollection = client.db("doctorsPortaldb").collection("payments");
        app.get('/appointmentOptions', async (req, res) => {
            const date = req.query.date;

            const query = {};
            /// Available options er collection.
            const optionCollection = await appointmentOptionsCollection.find(query).toArray();
            const bookingQuery = { appointmentDate: date }
            const alreadyBooked = await bookingCollection.find(bookingQuery).toArray();
            optionCollection.forEach(option => {
                const booked = alreadyBooked.filter(book => book.treatment === option.name);
                const bookedSlot = booked.map(book => book.slot);
                const remainingSlots = option.slots.filter(slot => !bookedSlot.includes(slot));
                option.slots = remainingSlots;
            })

            res.send(optionCollection);
        });

        app.get('/bookings', async (req, res) => {
            const email = req.query.email;
            // const decodedEmail = decoded.email;
            // console.log(decodedEmail)
            // if(email != decodedEmail){
            //     return res.status(403).send({message: "Forbidden Access"});
            // }
            console.log(email);
            const query = { email: email }
            const booking = await bookingCollection.find(query).toArray();
            res.send(booking);
        })


        app.post('/bookings', async (req, res) => {
            const bookings = req.body;
            const query = {
                appointmentDate: bookings.appointmentDate,
                email: bookings.email,
                treatment: bookings.treatment
            }
            const alreadyBooked = await bookingCollection.find(query).toArray();
            if (alreadyBooked.length) {
                const message = `You already have a booking on ${bookings.appointmentDate}`;
                return res.send({ acknowledged: false, message });
            }

            const result = await bookingCollection.insertOne(bookings);

            res.send(result);
        })

        app.get('/users', async(req, res) => {
            const user = {}
            const result = await usersCollection.find(user).toArray();
            res.send(result);
        })

        app.post('/users', async (req, res) => {
            const users = req.body;
            const result = await usersCollection.insertOne(users);
            res.send(result);
        })

        app.get('/jwt', async (req, res) => {
            const email = req.query.email;
            const query = { email: email }
            const user = await usersCollection.findOne(query);
            if (user) {
                const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '1hr' })
                return res.send({ accessToken: token });
            }
            res.status(403).send({ accessToken: "" })
        })

        app.put('/users/admin/:id', async(req, res) => {
            const id = req.params.id;
            const filter = {_id: ObjectId(id)};
            const options = {upsert: true};
            const updateDoc = {
                $set: {
                    role: 'admin'
                }
            };
            const result = await usersCollection.updateOne(filter, updateDoc, options);
            res.send(result);
        })

        app.get('/users/admin/:email', async(req, res) => {
            const email = req.params.email;
            const query = {email};
            const result = await usersCollection.findOne(query);
            res.send({isAdmin : result?.role === 'admin'});
        })

        app.get('/doctorspecialty', async(req, res) => {
            const query = {};
            const result = await appointmentOptionsCollection.find(query).project({name:1}).toArray();
            res.send(result);
        })

        app.post('/doctors', async(req, res) => {
            const doctor = req.body;
            const result = await doctorsCollection.insertOne(doctor);
            res.send(result);
        });

        app.get('/doctors', async(req, res) => {
            const query = {};
            const result = await doctorsCollection.find(query).toArray();
            res.send(result);
        });

        app.delete('/doctors/:id', async(req, res) => {
            const id = req.params.id;
            const query = {_id : ObjectId(id)};
            const result = await doctorsCollection.deleteOne(query);
            res.send(result);
        });

        app.get('/addprice', async(req, res) => {
            const query = {};
            const options = {upsert: true};
            const updateDoc = {
                $set: {
                    price: 99
                }
            }
            const result = await appointmentOptionsCollection.updateMany(query, updateDoc, options);
            res.send(result)
        });

        app.get('/bookings/:id', async(req, res) => {
            const id = req.params.id;
            const query = {_id : ObjectId(id)};
            const result = await bookingCollection.findOne(query);
            res.send(result);
        });

        app.post('/create-payment-intent', async(req, res) => {
            const booking = req.body;            
            const price = booking.price;
            const amount = price * 100;
            console.log(amount);

            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card'],
              });        
            res.send({clientSecret: paymentIntent.client_secret});
        });

        app.post('/payments', async(req, res) => {
            const payment = req.body;
            const result = await paymentsCollection.insertOne(payment);
            const id = payment.bookingId;
            const filter = {_id : ObjectId(id)};
            const updateDoc = {
                $set: {
                    paid : true,
                    transactionId : payment.transactionId
                }
            }
            const updateResult = await bookingCollection.updateOne(filter, updateDoc);
            res.send(result);
        })
    }
    finally {

    }

}
run().catch(console.log);

app.get('/', (req, res) => {
    res.send("Doctors portal server is running");
})




app.listen(port, () => {
    console.log("Listen to the port", port);
})