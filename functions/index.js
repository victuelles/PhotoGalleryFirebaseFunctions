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

const md5 = require('md5');

const sizeOf = require('image-size')

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
//const storageRef=admin.storage();

let form_uid="";
let form_eventID="";

exports.onCreateThumbnails= functions.storage.object().onFinalize(object => {
    const bucket = object.bucket;
    const contentType = object.contentType;
    const filePath = object.name;
 
    console.log('File change detected, function execution started path.basename(filePath)=',path.basename(filePath));

    if (object.resourceState === 'not_exists') {
        console.log('We deleted a file, exit...');
        return;
    }

    if (path.basename(filePath).startsWith('thumb_')) {
        console.log('We already renamed that file!');
        return;
    }
    let form_uid='';
    let eventID='';
    let uuid = UUID();
    const destBucket = gcs.bucket(bucket);
    const tmpFilePath = path.join(os.tmpdir(), path.basename(filePath));
    const metadata = { contentType: contentType,
                      metadata: {
                        firebaseStorageDownloadTokens: uuid
                      }
                   };
    let fileId=path.parse(filePath).name;//returns fileId from filename
    var tmpRef = db.ref('tmp').child(fileId);
    let thumbFilename='thumb_' + path.basename(filePath);
    tmpRef.once("value", (data)=> {

      form_uid=data.val().uid;
      eventID=data.val().eventID;

      thumbFilename=form_uid+'/'+thumbFilename
    
    })
    console.log('thumbFilename=',thumbFilename);

     return destBucket
        .file(filePath)
        .download({
            destination: tmpFilePath
        }).then(() => {
            return spawn('convert', [tmpFilePath, '-resize', '500x500', tmpFilePath]);
        }).then(()=>{
            console.log("destination thumbFilename=",thumbFilename)
            return destBucket.upload(tmpFilePath, {
              destination:  thumbFilename,
              metadata: metadata
              });
          }).then((data) => {
          let file = data[0];
     
          console.log("file.name =",file.name); //thumb_kMhtzqVUGTXEilsPqriUwTV6O1t1.jpg
          console.log("form_uid =",form_uid); //user id
          console.log("eventID =",eventID);   //
          console.log("fileId =",fileId);   //
       
          const img_thumb_url = 'https://firebasestorage.googleapis.com/v0/b/'+ destBucket.name + '/o/'
          + encodeURIComponent(file.name)
          + '?alt=media&token='
          + uuid

          console.log("img_thumb_url =",img_thumb_url);

          //Save to realtime db /uploads/$uid/$event/$fileid

          var dimensions = sizeOf(tmpFilePath);
          console.log("dimensions.width= ",dimensions.width," height=", dimensions.height);
          let w=3
          let h=2
          if( dimensions.height>dimensions.width){
              w=2
              h=3
          }  
          var uploadsRef = db.ref("uploads").child(form_uid).child(eventID).child(fileId);
          uploadsRef.update({
            'thumbnailUrl':img_thumb_url,
            'height':h,
            'width':w
          });

          var filesRef = db.ref('files').child(form_uid).child(fileId);
          //Save to realtime db /files/$uid/fileID
          filesRef.update({
            'thumbnailUrl': img_thumb_url,
            'height':h,
            'width':w
          });

         
 

        return data;

     }).catch(err =>{
        return err
     });
});



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
    
      let fileId=''
      let  newFileName=""
      busboy.on('file', (fieldname, file, filename, encoding, mimetype)=> {
        const filepath = path.join(os.tmpdir(), filename);
        uploadData = { file: filepath, 
                       type: mimetype,
                       uid:form_uid, 
                       eventID:form_eventID };
        file.pipe(fs.createWriteStream(filepath));
        
        parsingType='File';
     
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
     
       fileId =md5( uploadData.uid+encodeURIComponent(uploadData.file)+Date.now().toString()) 
        newFileName = fileId+ path.extname(uploadData.file);
        bucket.upload(uploadData.file, {
          destination: uploadData.uid+"/" + newFileName,
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
          
           const downloadURL="https://firebasestorage.googleapis.com/v0/b/" + bucket.name + "/o/" + encodeURIComponent(file.name) + "?alt=media&token=" + uuid;
          
           // handle url 
           console.log('----  bucket.upload ->  **** uid',uploadData.uid)
          
           
     
             var filesRef = db.ref('files').child(uploadData.uid).child(fileId);
             var dimensions = sizeOf(uploadData.file);
             filesRef.update({
               'url':downloadURL,
               'eventID':uploadData.eventID,
               'filename': newFileName,
               'originalname': path.basename(uploadData.file),
               'file_height':dimensions.height,
               'file_width':dimensions.width

             });
             console.log('----  bucket.upload ->  **** filesRef',downloadURL)
           
            //write to "uploads" node
             var uploadsRef = db.ref('uploads').child(uploadData.uid).child(uploadData.eventID).child(fileId);
            
             uploadsRef.update({
               'url':downloadURL,
               'originalname': path.basename(uploadData.file),
               'filename': newFileName
             });
             console.log('----  bucket.upload ->  **** uploadsRef',file.name)
        
             //write tmp folder uid
             var tmpRef = db.ref('tmp').child(fileId);
            
             tmpRef.update({
               'uid':form_uid,
               'eventID': uploadData.eventID,
             });

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
