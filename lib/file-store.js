const path = require('path');
const fsPromises = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const debug = require('debug')('prairielearn:' + path.basename(__filename, '.js'));
const sqldb = require('@prairielearn/prairielib/sql-db');
const config = require('../lib/config');
const logger = require('../lib/logger');
const sqlLoader = require('@prairielearn/prairielib/sql-loader');
const sql = sqlLoader.loadSqlEquiv(__filename);
const AWS = require('aws-sdk');

/**
 * Upload a file into the file store.
 *
 * @param {string} display_filename - The display_filename of the file.
 * @param {Buffer} contents - The file contents.
 * @param {string} type - The file type.
 * @param {number|null} assessment_instance_id - The assessment instance for the file.
 * @param {number|null} instance_question_id - The instance question for the file.
 * @param {number} user_id - The current user performing the update.
 * @param {number} authn_user_id - The current authenticated user.
 * @param {string} mode - AWS 's3' or 'filesystem' storage options.
 * @return {number} The file_id of the newly created file.
 */

module.exports.modes = Object.freeze({S3: 's3', FileSystem: 'fileSystem'});

module.exports.upload = async (display_filename, contents, type, assessment_instance_id, instance_question_id, user_id, authn_user_id, mode) => {

    const f = uuidv4();
    const relDir = path.join(f.slice(0,3), f.slice(3,6));
    const storage_filename = path.join(relDir, f.slice(6));
    const dir = path.join(config.filesRoot, relDir);
    let filename = path.join(config.filesRoot, storage_filename);

    // uploads to ec2 filesystem
    if (mode === this.modes.FileSystem) {
        debug('upload()');
        // Make a filename to store the file. We use a UUIDv4 as the filename,
        // and put it in two levels of directories corresponding to the first-3
        // and second-3 characters of the filename.

        if (config.filesRoot == null) throw new Error('config.filesRoot is null, which does not allow uploads');

        debug(`uploadFile() : mkdir ${dir}`);
        await fsPromises.mkdir(dir, {recursive: true, mode: 0o700});
        debug(`uploadFile(): writeFile ${filename}`);
        await fsPromises.writeFile(filename, contents, {mode: 0o600});
        const params = [
            display_filename,
            storage_filename,
            type,
            assessment_instance_id,
            instance_question_id,
            user_id,
            authn_user_id,
        ];
        const result = await sqldb.callAsync('files_insert', params);
        debug('upload(): inserted files row into DB');
    
        return result.rows[0].file_id;
    }

    // uploads to s3 bucket
    if (mode === this.modes.S3) {
        if (filename[0] === '/') filename = filename.substring(1);
        const s3 = new AWS.S3(config.awsServiceGlobalOptions);
        const params = {
            Bucket: config.fileUploadS3Bucket,
            Key: filename,
            Body: Buffer.from(contents, 'base64'),
            ContentEncoding: 'base64',
        };

        const result = await s3.upload(params, (err, data) => {
            if (err) throw new Error(`S3 upload error: ` + err);
            logger.info(`File upload to S3 successful ${data}`);
        });

        console.log(result);

    }

    if (!mode) throw new Error('Undefined mode for file upload.');
};

/**
 * Soft-delete a file from the file store, leaving the physical file on disk.
 *
 * @param {number} file_id - The file to delete.
 * @param {number} authn_user_id - The current authenticated user.
 */
module.exports.delete = async (file_id, authn_user_id) => {
    debug(`delete(): file_id=${file_id}`);
    debug(`delete(): authn_user_id=${authn_user_id}`);

    const params = [
        file_id,
        authn_user_id,
    ];
    await sqldb.callAsync('files_delete', params);
    debug('delete(): soft-deleted row in DB');
};

/**
 * Get a file from the file store.
 *
 * @param {number} file_id - The file to get.
 * @return {object} An object with a buffer (of the file contents) and a file object.
 */
module.exports.get = async (file_id) => {
    debug(`get(): file_id=${file_id}`);

    const params = { file_id };
    const result = await sqldb.queryZeroOrOneRowAsync(sql.select_file, params);
    debug('get(): got row from DB');

    if (result.rows.length < 1) {
        throw new Error(`No file with file_id ${file_id}`);
    }

    if (config.filesRoot == null) throw new Error(`config.filesRoot must be non-null to get file_id ${file_id} from file store`);
    const filename = path.join(config.filesRoot, result.rows[0].storage_filename);

    debug(`get(): readFile ${filename} and return object with contents buffer and file object`);
    const contents = await fsPromises.readFile(filename);
    return {
        contents: contents,
        file: result.rows[0],
    };
};
