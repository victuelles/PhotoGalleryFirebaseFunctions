const functions = require('firebase-functions');
const os = require('os');
const path = require('path');
const spawn = require('child-process-promise').spawn;
const cors = require('cors')({origin:true});
const fs = require('fs');
const mkdirp = require('mkdirp-promise');
const Busboy = require('busboy');
var admin = require("firebase-admin");
const UUID = require("uuid-v4");
const inspect = require('util').inspect;
const { parse } = require('querystring');
const md5 = require('md5');
const STORAGE_URL ="eventphotogallery-ed881.appspot.com"
const PROJECT_ID='eventphotogallery-ed881'
const PROJECT_PRIVATEKEY_FILE='eventphotogallery.json'
//eventphotogallery-ed881-firebase-adminsdk-u3vz1-ee34ba401d.json'
const DATABASE_URL="https://eventphotogallery-ed881.firebaseio.com"
const gcconfig={
    projectId: PROJECT_ID,
    keyFilename:PROJECT_PRIVATEKEY_FILE
}
const gcs = require('@google-cloud/storage')(gcconfig);

// Initialize the app with a service account, granting admin privileges
admin.initializeApp({
  credential: admin.credential.cert(gcconfig.keyFilename),
  databaseURL:DATABASE_URL
});
const  db = admin.database();
const storageRef=admin.storage();

exports.onFileChange= functions.storage.object().onFinalize(object => {
    const bucket = object.bucket;
    const contentType = object.contentType;
    const filePath = object.name;
    console.log('File change detected, function execution started');

    if (object.resourceState === 'not_exists') {
        console.log('We deleted a file, exit...');
        return;
    }

    if (path.basename(filePath).startsWith('resized-')) {
        console.log('We already renamed that file!');
        return;
    }
    let uuid = UUID();
    const destBucket = gcs.bucket(bucket);
    const tmpFilePath = path.join(os.tmpdir(), path.basename(filePath));
    const metadata = { contentType: contentType,
                      metadata: {
                        firebaseStorageDownloadTokens: uuid
                      }
                   };
    
     return destBucket
        .file(filePath)
        .download({
            destination: tmpFilePath
        }).then(() => {
            return spawn('convert', [tmpFilePath, '-resize', '500x500', tmpFilePath]);
        }).then(() => {
            //save
      //    console.log("tmpFilePath=",tmpFilePath);
       //   console.log("metadata=",metadata);
           return destBucket.upload(tmpFilePath, {
            destination: 'resized-' + path.basename(filePath),
            metadata: metadata
            });
          }).then((data) => {
          let file = data[0];
          userUID=path.parse(filePath).name;
          let uid=userUID.substring(0,userUID.indexOf('_ID'))
          console.log("file.name =",file.name); //resized-kMhtzqVUGTXEilsPqriUwTV6O1t1_ID.jpg
          console.log("uid =",uid);
          const img_thumb_url = 'https://firebasestorage.googleapis.com/v0/b/'+ destBucket.name + '/o/'
          + encodeURIComponent(file.name)
          + '?alt=media&token='
          + uuid

          console.log("img_thumb_url =",img_thumb_url);
          //Save to realtime db /users/$uid/
          var ref = db.ref("users"); 
          var userFilesRef = ref.child(uid);
          userFilesRef.update({
            'photoUrlIdThumb':img_thumb_url,
          });

          var thumbRef = storageRef.child(file.name);
          thumbRef.getDownloadURL().then((url)=> {
            console.log("getDownloadURL =",url);
            return url;
          }).catch((error)=> {
            console.log(error)
          });


    
        return data;

     }).catch(err =>{
        return err
     });
});

let form_uid="";
let form_eventID="";

exports.uploadFile = functions.https.onRequest((req, res) => {
    cors(req, res, () => {
      if (req.method !== "POST") {
        return res.status(500).json({
          message: "Not allowed"
        });
      }
      let formParams ={}; 

      var busboy = new Busboy({ headers: req.headers });
      let parsingType="";
      let fieldArray=[]
      let uploadData = null;
      var ref = db.ref("users");  
      
      busboy.on('file', (fieldname, file, filename, encoding, mimetype)=> {
        const filepath = path.join(os.tmpdir(), filename);
        uploadData = { file: filepath, 
                       type: mimetype,
                       uid:form_uid, 
                       eventID:form_eventID };
        file.pipe(fs.createWriteStream(filepath));
        
        parsingType='File';
      //  console.log('File [' + fieldname + ']: filename: ' + filename);
      /*  file.on('data', (data)=> {
     //     console.log('File [' + fieldname + '] got ' + data.length + ' bytes');
     
          const filepath = path.join(os.tmpdir(), filename);
          uploadData = { file: filepath, 
                         type: mimetype,
                         uid:form_uid, 
                         eventID:form_eventID };
          file.pipe(fs.createWriteStream(filepath));

        });
        file.on('end',()=> {
       //   console.log('File [' + fieldname + '] Finished');
          parsingType='File';
        });*/
      });
      busboy.on('field', (fieldname, val, fieldnameTruncated, valTruncated)=> {
       // console.log('Field [' + fieldname + ']: value: ' + inspect(val));
        parsingType='field';

        let o=fieldname+'|'+val;       
        fieldArray.push({o} )
      });
      busboy.on('finish', ()=> {
    //    console.log('Done parsing form parsingType=',parsingType);
        if(parsingType==='field'){
          fieldArray.map(obj=>{
            if(obj) {
              var s=obj.o.split('|');
              var key=s[0]
              var val=s[1]
              formParams[key]=val
            }
          })
        //  console.log('formParams =',formParams)
          form_uid=formParams.uid;
          form_eventID=formParams.eventID;
          return res.status(304).json({
            message: "It worked!"
          });
        } else {


          let  uuid = UUID();
          const bucket = gcs.bucket(STORAGE_URL);
       //   console.log('----  bucket.upload ->  **** uploadData',uploadData)
        bucket.upload(uploadData.file, {
           uploadType: "media",
           metadata: {
             metadata: {
               contentType: uploadData.type,
               firebaseStorageDownloadTokens: uuid
             }
            }
        })
        .then((data) => {
        console.log('----  bucket.upload ->  **** data',data[0])
           let file = data[0];
           let fileId=md5( uploadData.uid+encodeURIComponent(file.name)+Date.now().toString()) 
           const downloadURL="https://firebasestorage.googleapis.com/v0/b/" + bucket.name + "/o/" + encodeURIComponent(file.name) + "?alt=media&token=" + uuid;
          
           // handle url 
           console.log('----  bucket.upload ->  **** uid',uploadData.uid)
          
             var userFilesRef = ref.child(uploadData.uid);
             userFilesRef.update({
               'photoUrlId':downloadURL,
               'photoUrlFileId':fileId
             });
             console.log(fileId,'----  bucket.upload ->  **** userFilesRef',uploadData.eventID)
     
             var filesRef = ref.parent.child('files').child(uploadData.uid).child(fileId);
            
             filesRef.update({
               'url':downloadURL,
               'eventID':uploadData.eventID
             });
             console.log('----  bucket.upload ->  **** filesRef',downloadURL)
     
            return res.status(200).json({
              message: "It worked!"
            });
          }).catch(err => {
            return res.status(500).json({
               error: err
             })
           })
        }
      //  res.end();
      })
      busboy.end(req.rawBody);
    });
  });



// File extension for the created JPEG files.
const JPEG_EXTENSION = '.jpg';

/**
 * When an image is uploaded in the Storage bucket it is converted to JPEG automatically using
 * ImageMagick.
 */
/*
exports.imageToJPG = functions.storage.object().onFinalize((object) => {
  const filePath = object.name;
  const baseFileName = path.basename(filePath, path.extname(filePath));
  const fileDir = path.dirname(filePath);
  const JPEGFilePath = path.normalize(path.format({dir: fileDir, name: baseFileName, ext: JPEG_EXTENSION}));
  const tempLocalFile = path.join(os.tmpdir(), filePath);
  const tempLocalDir = path.dirname(tempLocalFile);
  const tempLocalJPEGFile = path.join(os.tmpdir(), JPEGFilePath);

  // Exit if this is triggered on a file that is not an image.
  if (!object.contentType.startsWith('image/')) {
    console.log('This is not an image.');
    return null;
  }

  // Exit if the image is already a JPEG.
  if (object.contentType.startsWith('image/jpeg')) {
    console.log('Already a JPEG.');
    return null;
  }

  const bucket = gcs.bucket(object.bucket);
  // Create the temp directory where the storage file will be downloaded.
  return mkdirp(tempLocalDir).then(() => {
    // Download file from bucket.
    return bucket.file(filePath).download({destination: tempLocalFile});
  }).then(() => {
    console.log('The file has been downloaded to', tempLocalFile);
    // Convert the image to JPEG using ImageMagick.
    return spawn('convert', [tempLocalFile, tempLocalJPEGFile]);
  }).then(() => {
    console.log('JPEG image created at', tempLocalJPEGFile);
    // Uploading the JPEG image.
    return bucket.upload(tempLocalJPEGFile, {destination: JPEGFilePath});
  }).then(() => {
    console.log('JPEG image uploaded to Storage at', JPEGFilePath);
    // Once the image has been converted delete the local files to free up disk space.
    fs.unlinkSync(tempLocalJPEGFile);
    fs.unlinkSync(tempLocalFile);
    return;
  });
});
*/