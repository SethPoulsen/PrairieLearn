const ERR = require('async-stacktrace');
const _ = require('lodash');
const async = require('async');

const path = require('path');
const debug = require('debug')('prairielearn:' + path.basename(__filename, '.js'));

const config = require('../lib/config');
const error = require('@prairielearn/prairielib/error');
const sqldb = require('@prairielearn/prairielib/sql-db');
const sqlLoader = require('@prairielearn/prairielib/sql-loader');

const sql = sqlLoader.loadSqlEquiv(__filename);

module.exports = function(req, res, next) {
    // debug(req.params);

    // debug(res.locals);

    const isCourseInstance = Boolean(req.params.course_instance_id);
    // debug(`this is a course instance: ${isCourseInstance}`);

    // Note that req.params.course_id and req.params.course_instance_id are strings and not
    // numbers - this is why we can use the pattern "id ? id : null" to check if they exist.
    const params = {
        authn_user_id: res.locals.authn_user.user_id,   // FIXME: don't mislead - call this just user_id (b/c it'll be that for effective user)
        course_id: req.params.course_id ? req.params.course_id : null,
        course_instance_id: req.params.course_instance_id ? req.params.course_instance_id : null,
        is_administrator: res.locals.is_administrator,
        req_date: res.locals.req_date,
        ip: req.ip,
        force_mode: (config.authType == 'none' && req.cookies.pl_requested_mode) ? req.cookies.pl_requested_mode : null,
        req_course_role: null,  // FIXME: rename as force_course_role?
        req_course_instance_role: null,  // FIXME: rename as force_course_instance_role?
    };

    if ((params.course_id == null) && (params.course_instance_id == null)) {
        next(error.make(403, 'Access denied (both course_id and course_instance_id are null)'));
    }

    sqldb.queryZeroOrOneRow(sql.select_authz_data, params, function(err, result) {
        if (ERR(err, next)) return;
        if (result.rowCount == 0) return next(error.make(403, 'Access denied'));

        let authn_mode = result.rows[0].mode;
        res.locals.course = result.rows[0].course;
        res.locals.courses = result.rows[0].courses;
        res.locals.course_instances = result.rows[0].course_instances;

        const permissions_course = result.rows[0].permissions_course;
        res.locals.authz_data = {
            authn_user: _.cloneDeep(res.locals.authn_user),
            authn_mode: authn_mode,
            authn_course_role: permissions_course.course_role,
            authn_has_course_permission_preview: permissions_course.has_course_permission_preview,
            authn_has_course_permission_view: permissions_course.has_course_permission_view,
            authn_has_course_permission_edit: permissions_course.has_course_permission_edit,
            authn_has_course_permission_own: permissions_course.has_course_permission_own,
            user: _.cloneDeep(res.locals.authn_user),
            mode: authn_mode,
            course_role: permissions_course.course_role,
            has_course_permission_preview: permissions_course.has_course_permission_preview,
            has_course_permission_view: permissions_course.has_course_permission_view,
            has_course_permission_edit: permissions_course.has_course_permission_edit,
            has_course_permission_own: permissions_course.has_course_permission_own,
        };

        // debug(res.locals.course)
        // debug(permissions_course);

        if (isCourseInstance) {
            res.locals.course_instance = result.rows[0].course_instance;

            const permissions_course_instance = result.rows[0].permissions_course_instance;
            res.locals.authz_data.authn_course_instance_role = permissions_course_instance.course_instance_role;
            res.locals.authz_data.authn_has_course_instance_permission_view = permissions_course_instance.has_course_instance_permission_view;
            res.locals.authz_data.authn_has_course_instance_permission_edit = permissions_course_instance.has_course_instance_permission_edit;
            res.locals.authz_data.authn_is_enrolled_with_access = permissions_course_instance.is_enrolled_with_access;
            res.locals.authz_data.course_instance_role = permissions_course_instance.course_instance_role;
            res.locals.authz_data.has_course_instance_permission_view = permissions_course_instance.has_course_instance_permission_view;
            res.locals.authz_data.has_course_instance_permission_edit = permissions_course_instance.has_course_instance_permission_edit;
            res.locals.authz_data.is_enrolled_with_access = permissions_course_instance.is_enrolled_with_access;

            // debug(res.locals.course_instance)
            // debug(permissions_course_instance);
        }

        res.locals.user = res.locals.authz_data.user;
        // effective user data defaults to auth user data

        // Check if it is necessary to request a user data override. We don't want
        // to duplicate the select_authz_data query if we don't have to.

        let overrides = [];
        if (req.cookies.pl_requested_uid) {
            overrides.push({'name': 'UID', 'value': req.cookies.pl_requested_uid, 'cookie': 'pl_requested_uid'});
        }
        if (req.cookies.pl_requested_course_role) {
            overrides.push({'name': 'Course role', 'value': req.cookies.pl_requested_course_role, 'cookie': 'pl_requested_course_role'});
        }
        if (req.cookies.pl_requested_course_instance_role) {
            overrides.push({'name': 'Course instance role', 'value': req.cookies.pl_requested_course_instance_role, 'cookie': 'pl_requested_course_instance_role'});
        }
        if (req.cookies.pl_requested_mode) {
            overrides.push({'name': 'Mode', 'value': req.cookies.pl_requested_mode, 'cookie': 'pl_requested_mode'});
        }
        if (req.cookies.pl_requested_date) {
            overrides.push({'name': 'Date', 'value': req.cookies.pl_requested_date, 'cookie': 'pl_requested_date'});
        }
        if (overrides.length > 0) {
            res.locals.authz_data.overrides = overrides;
        } else if (!(res.locals.max_access_level && (res.locals.is_administrator || (res.locals.max_access_level == 'Student')))) {
            return next();
        }

        // This is what we might do if we only wanted to proceed if absolutely necessary
        //
        // if (req.cookies.pl_requested_uid && (req.cookies.pl_requested_uid != res.locals.uid)) {
        //     overrides.push({'name': 'UID', 'value': req.cookies.pl_requested_uid, 'cookie': 'pl_requested_uid'});
        // }
        // if (req.cookies.pl_requested_course_role && (req.cookies.pl_requested_course_role != res.locals.authz_data.course_role)) {
        //     overrides.push({'name': 'Course role', 'value': req.cookies.pl_requested_course_role, 'cookie': 'pl_requested_course_role'});
        // }
        // if (req.cookies.pl_requested_course_instance_role && (req.cookies.pl_requested_course_instance_role != res.locals.authz_data.course_instance_role)) {
        //     overrides.push({'name': 'Course instance role', 'value': req.cookies.pl_requested_course_instance_role, 'cookie': 'pl_requested_course_instance_role'});
        // }
        // if (req.cookies.pl_requested_mode && (req.cookies.pl_requested_mode != res.locals.authz_data.mode)) {
        //     overrides.push({'name': 'Mode', 'value': req.cookies.pl_requested_mode, 'cookie': 'pl_requested_mode'});
        // }
        // if (req.cookies.pl_requested_date && (req.cookies.pl_requested_date != res.locals.req_date)) {
        //     overrides.push({'name': 'Date', 'value': req.cookies.pl_requested_date, 'cookie': 'pl_requested_date'});
        // }
        // if (overrides.length > 0) {
        //     res.locals.authz_data.overrides = overrides;
        // } else if (!(res.locals.max_access_level && (res.locals.is_administrator || (res.locals.max_access_level == 'Student')))) {
        //     return next();
        // }

        // Must be at least an Editor in course to request a user data override
        if (!res.locals.authz_data.has_course_permission_edit) {
            return next(new Error('Access denied (insufficient permissions to change the effective user)'));
        }

        // We are trying to override the user data.
        debug('trying to override the user data');
        debug(req.cookies);

        // Get roles
        let is_administrator = res.locals.is_administrator;
        let req_course_role = (req.cookies.pl_requested_course_role ? req.cookies.pl_requested_course_role : null);
        let req_course_instance_role = (req.cookies.pl_requested_course_instance_role ? req.cookies.pl_requested_course_instance_role : null);

        res.locals.authz_data.override = true;
        debug(res.locals.authz_data.override);

        async.series([
            //
            // // FIXME
            //
            // (callback) => {
            //     if (res.locals.course_instance) {
            //         // Ensure we are enrolled in this course instance (we are already authorized, so this must be ok).
            //         const params = {
            //             course_instance_id: res.locals.course_instance.id,
            //             user_id: res.locals.authn_user.user_id,
            //             role: res.locals.authz_data.authn_role,     // FIXME
            //         };
            //         sqldb.query(sql.ensure_enrollment, params, function(err, _result) {
            //             if (ERR(err, callback)) return;
            //             callback(null);
            //         });
            //     } else {
            //         callback(null);
            //     }
            // },
            (callback) => {
                if (req.cookies.pl_requested_uid) {
                    const params = {
                        uid: req.cookies.pl_requested_uid,
                    };

                    sqldb.queryZeroOrOneRow(sql.select_user, params, function(err, result) {
                        if (ERR(err, callback)) return;
                        if (result.rowCount == 0) {
                            let err = error.make(403, 'Access denied');
                            err.info =  `<p>You have tried to change the effective user to one with uid` +
                                        `${req.cookies.pl_requested_uid}, when no such user exists.` +
                                        `To reset the effective user, return to the ` +
                                        `<a href="${res.locals.homeUrl}">PrairieLearn home page</a>.</p>`;
                            return callback(err);
                        }

                        // FIXME: should base this check on max_access_level as well
                        is_administrator = result.rows[0].is_administrator;
                        if (is_administrator && (!res.locals.is_administrator)) {
                            let err = error.make(403, 'Access denied');
                            err.info =  `<p>You have tried to change the effective user to one who is an` +
                                        `administrator, when you are not an administrator. To reset the effective user,` +
                                        `return to the <a href="${res.locals.homeUrl}">PrairieLearn home page</a>.</p>`;
                            return callback(err);
                        }

                        res.locals.authz_data.user = _.cloneDeep(result.rows[0].user);
                        res.locals.user = res.locals.authz_data.user;
                        // FIXME: also override institution?
                        callback(null);
                    });
                } else {
                    callback(null);
                }
            },
            (callback) => {
                // Access level only acts to drop roles
                if (res.locals.max_access_level == 'Student') {
                    is_administrator = false;
                    req_course_role = 'None';
                    req_course_instance_role = 'None';
                } else if (res.locals.max_access_level == 'Instructor') {
                    is_administrator = false;
                }

                // Now do the actual override
                const params = {
                    authn_user_id: res.locals.user.user_id, // FIXME: don't mislead - call this just user_id
                    course_id: req.params.course_id ? req.params.course_id : null,
                    course_instance_id: req.params.course_instance_id ? req.params.course_instance_id : null,
                    is_administrator: is_administrator,
                    req_date: res.locals.req_date,
                    ip: req.ip,
                    force_mode: (config.authType == 'none' && req.cookies.pl_requested_mode) ? req.cookies.pl_requested_mode : null, // FIXME: still necessary?
                    req_course_role: req_course_role,
                    req_course_instance_role: req_course_instance_role,
                };

                // FIXME: do is_enrolled_with_access override...

                debug(params);

                sqldb.queryZeroOrOneRow(sql.select_authz_data, params, function(err, result) {
                    if (ERR(err, callback)) return;
                    // if (result.rowCount == 0) return callback(error.make(403, 'Access denied (FIXME A)'));
                    // if (result.rowCount == 0) {
                    //     // The effective user has been denied access. For a real user, two things would be true:
                    //     //
                    //     //  1) authn_user would exist
                    //     //  2) authz_data would not exist
                    //     //
                    //     // Unfortunately, for the effective user, both authn_user and authz_data exist but are
                    //     // "wrong" in the sense that they are consistent with the real user and not the effective
                    //     // user. This screws up various things on the error page.
                    //     //
                    //     // As a fix for now, we will remove authz_data and will set a flag saying that the
                    //     // effective user has been denied access to the course instance - this will allow, for
                    //     // example, the user dropdown in the navbar to be hidden. It is likely that a better
                    //     // solution can be found when this code is all rewritten.
                    //     delete res.locals.authz_data;
                    //     res.locals.effective_user_has_no_access_to_course_instance = true; // FIXME: maybe it's no access just to course...
                    //
                    //     // Tell the real user what happened and how to reset the effective user.
                    //     let err = error.make(403, 'Access denied (FIXME B)');
                    //     // err.info =  `<p>You have changed the effective user to one with these properties:</p>` +
                    //     //             `<div class="container"><pre class="bg-dark text-white rounded p-2">` +
                    //     //             `uid = ${params.requested_uid}\n` +
                    //     //             `role = ${params.requested_role}\n` +
                    //     //             `mode = ${params.requested_mode}\n` +
                    //     //             `</pre></div>` +
                    //     //             `<p>This user does not have access to the course instance <code>${res.locals.course_instance.short_name}</code> (with long name "${res.locals.course_instance.long_name}").` +
                    //     //             `<p>To reset the effective user, return to the <a href="${res.locals.homeUrl}">PrairieLearn home page</a>.</p>`;
                    //     return callback(err);
                    // }
                    if (result.rowCount == 0) {
                        debug('The effective user has been denied access.');

                        // The effective user has been denied access. For a real user, two things would be true:
                        //
                        //  1) authn_user would exist
                        //  2) authz_data would not exist
                        //
                        // Unfortunately, for the effective user, both authn_user and authz_data exist but are
                        // "wrong" in the sense that they are consistent with the real user and not the effective
                        // user. This screws up various things on the error page.
                        //
                        // As a fix for now, we will remove authz_data and will set a flag saying that the
                        // effective user has been denied access to the course instance - this will allow, for
                        // example, the user dropdown in the navbar to be hidden. It is likely that a better
                        // solution can be found when this code is all rewritten.

                        res.locals.authz_data.course_role = 'None';
                        res.locals.authz_data.has_course_permission_preview = false;
                        res.locals.authz_data.has_course_permission_view = false;
                        res.locals.authz_data.has_course_permission_edit = false;
                        res.locals.authz_data.has_course_permission_own = false;

                        if (isCourseInstance) {
                            res.locals.authz_data.course_instance_role = 'None';
                            res.locals.authz_data.has_course_instance_permission_view = false;
                            res.locals.authz_data.has_course_instance_permission_edit = false;
                            res.locals.authz_data.is_enrolled_with_access = false;
                        }

                        // Tell the real user what happened and how to reset the effective user.
                        let err = error.make(403, 'Access denied');
                        if (overrides.length > 0) {
                            err.info =  `<p>You have changed the effective user to one with these properties:</p>` +
                                        `<div class="container"><pre class="bg-dark text-white rounded p-2">`;
                            overrides.forEach((override) => {
                                err.info += `${override.name} = ${override.value}\n`;
                            });
                            err.info += `</pre></div>` +
                                        `<p>This user does not have access to the `;
                            if (isCourseInstance) {
                                err.info += `course instance <code>${res.locals.course_instance.short_name}</code> (${res.locals.course_instance.long_name}).`;
                            } else {
                                err.info += `course <code>${res.locals.course.short_name}</code> (${res.locals.course.title}).`;
                            }
                            err.info += ` To reset the effective user, return to the <a href="${res.locals.homeUrl}">PrairieLearn home page</a>.</p>`;
                        } else {
                            err.info =  `<p>You have chosen to login with the <strong>${res.locals.max_access_level}</strong> user type. ` +
                                        `With this user type, you do not have access to the `;
                            if (isCourseInstance) {
                                err.info += `course instance <code>${res.locals.course_instance.short_name}</code> (${res.locals.course_instance.long_name}).`;
                            } else {
                                err.info += `course <code>${res.locals.course.short_name}</code> (${res.locals.course.title}).`;
                            }
                            err.info += ` To change the user type with which you login and to restore access, use the dropdown menu <strong>${res.locals.authn_user.name}</strong> in the navbar.`
                        }



                        // err.info = '';
                        // if (overrides.length > 0) {
                        //     err.info +=  `<p>You have changed the effective user to one with these properties:</p>` +
                        //                 `<div class="container"><pre class="bg-dark text-white rounded p-2">`;
                        //     overrides.forEach((override) => {
                        //         err.info += `${override.name} = ${override.value}\n`;
                        //     });
                        //     err.info += `</pre></div>`;
                        // }
                        // if (res.locals.max_access_level) {
                        //     err.info += `<p>You have restricted the maximum access level to <strong>${res.locals.max_access_level}</strong>.</p>`;
                        // }
                        // err.info += `<p>This user does not have access to the `;
                        // if (isCourseInstance) {
                        //     err.info += `course instance <code>${res.locals.course_instance.short_name}</code> (${res.locals.course_instance.long_name}).`;
                        // } else {
                        //     err.info += `course <code>${res.locals.course.short_name}</code> (${res.locals.course.title}).`;
                        // }
                        // err.info += `<p>To reset the effective user, return to the <a href="${res.locals.homeUrl}">PrairieLearn home page</a>.</p>`;
                        return callback(err);
                    }

                    // res.locals.authz_data = {
                    //     authn_user: _.cloneDeep(res.locals.authn_user),
                    //     authn_mode: authn_mode,
                    //     authn_course_role: permissions_course.course_role,
                    //     authn_has_course_permission_preview: permissions_course.has_course_permission_preview,
                    //     authn_has_course_permission_view: permissions_course.has_course_permission_view,
                    //     authn_has_course_permission_edit: permissions_course.has_course_permission_edit,
                    //     authn_has_course_permission_own: permissions_course.has_course_permission_own,
                    //     user: _.cloneDeep(res.locals.authn_user),
                    //     mode: authn_mode,
                    //     course_role: permissions_course.course_role,
                    //     has_course_permission_preview: permissions_course.has_course_permission_preview,
                    //     has_course_permission_view: permissions_course.has_course_permission_view,
                    //     has_course_permission_edit: permissions_course.has_course_permission_edit,
                    //     has_course_permission_own: permissions_course.has_course_permission_own,
                    // };
                    //
                    // // debug(res.locals.course)
                    // // debug(permissions_course);
                    //
                    // if (isCourseInstance) {
                    //     res.locals.course_instance = result.rows[0].course_instance;
                    //
                    //     const permissions_course_instance = result.rows[0].permissions_course_instance;
                    //     res.locals.authz_data.authn_course_instance_role = permissions_course_instance.course_instance_role;
                    //     res.locals.authz_data.authn_has_course_instance_permission_view = permissions_course_instance.has_course_instance_permission_view;
                    //     res.locals.authz_data.authn_has_course_instance_permission_edit = permissions_course_instance.has_course_instance_permission_edit;
                    //     res.locals.authz_data.authn_is_enrolled_with_access = permissions_course_instance.is_enrolled_with_access;
                    //     res.locals.authz_data.course_instance_role = permissions_course_instance.course_instance_role;
                    //     res.locals.authz_data.has_course_instance_permission_view = permissions_course_instance.has_course_instance_permission_view;
                    //     res.locals.authz_data.has_course_instance_permission_edit = permissions_course_instance.has_course_instance_permission_edit;
                    //     res.locals.authz_data.is_enrolled_with_access = permissions_course_instance.is_enrolled_with_access;
                    //
                    //     // debug(res.locals.course_instance)
                    //     // debug(permissions_course_instance);
                    // }



                    // debug(result.rows[0]);

                    // user: _.cloneDeep(res.locals.authn_user),
                    // mode: authn_mode,
                    // course_role: permissions_course.course_role,
                    // course_instance_role: permissions_course_instance.course_instance_role,
                    // has_course_permission_preview: permissions_course.has_course_permission_preview,
                    // has_course_permission_view: permissions_course.has_course_permission_view,
                    // has_course_permission_edit: permissions_course.has_course_permission_edit,
                    // has_course_permission_own: permissions_course.has_course_permission_own,
                    // has_course_instance_permission_view: permissions_course_instance.has_course_instance_permission_view,
                    // has_course_instance_permission_edit: permissions_course_instance.has_course_instance_permission_edit,

                    // It must be true that the authn_user is a course Editor. So,
                    // we need only check if the effective user is a course Owner and
                    // the authn_user is not.
                    if ((!res.locals.authz_data.has_course_permission_own) && result.rows[0].permissions_course.has_course_permission_own) {
                        let err = error.make(403, 'Access denied');
                        err.info =  `<p>You have tried to change the effective user to one who is a course` +
                                    `owner, when you are not a course owner. To reset the effective user,` +
                                    `return to the <a href="${res.locals.homeUrl}">PrairieLearn home page</a>.</p>`;
                        return callback(err);
                    }

                    res.locals.authz_data.course_role = result.rows[0].permissions_course.course_role;
                    res.locals.authz_data.has_course_permission_preview = result.rows[0].permissions_course.has_course_permission_preview;
                    res.locals.authz_data.has_course_permission_view = result.rows[0].permissions_course.has_course_permission_view;
                    res.locals.authz_data.has_course_permission_edit = result.rows[0].permissions_course.has_course_permission_edit;
                    res.locals.authz_data.has_course_permission_own = result.rows[0].permissions_course.has_course_permission_own;

                    if ((!res.locals.authz_data.has_course_instance_permission_view) && result.rows[0].permissions_course.has_course_instance_permission_view) {
                        let err = error.make(403, 'Access denied');
                        err.info =  `<p>You have tried to change the effective user to one who can view` +
                                    `student data in the course instance <code>${res.locals.course_instance.short_name}</code>, when` +
                                    `you do not have permission to view these student data. To reset the effective user,` +
                                    `return to the <a href="${res.locals.homeUrl}">PrairieLearn home page</a>.</p>`;
                        return callback(err);
                    }

                    if ((!res.locals.authz_data.has_course_instance_permission_edit) && result.rows[0].permissions_course.has_course_instance_permission_edit) {
                        let err = error.make(403, 'Access denied');
                        err.info =  `<p>You have tried to change the effective user to one who can edit` +
                                    `student data in the course instance <code>${res.locals.course_instance.short_name}</code>, when` +
                                    `you do not have permission to edit these student data. To reset the effective user,` +
                                    `return to the <a href="${res.locals.homeUrl}">PrairieLearn home page</a>.</p>`;
                        return callback(err);
                    }

                    res.locals.authz_data.course_instance_role = result.rows[0].permissions_course_instance.course_instance_role;
                    res.locals.authz_data.has_course_instance_permission_view = result.rows[0].permissions_course_instance.has_course_instance_permission_view;
                    res.locals.authz_data.has_course_instance_permission_edit = result.rows[0].permissions_course_instance.has_course_instance_permission_edit;

                    // FIXME - restore as many of the following lines as necessary

                    // res.locals.authz_data.user = result.rows[0].user;
                    // res.locals.authz_data.role = result.rows[0].role;
                    // res.locals.authz_data.mode = result.rows[0].mode;
                    // res.locals.req_date = result.rows[0].req_date;
                    //
                    // // Make sure that we never grant extra permissions
                    // res.locals.authz_data.has_instructor_view = res.locals.authz_data.has_instructor_view && result.rows[0].has_instructor_view;
                    // res.locals.authz_data.has_instructor_edit = res.locals.authz_data.has_instructor_edit && result.rows[0].has_instructor_edit;
                    // res.locals.authz_data.has_course_permission_view = res.locals.authz_data.has_course_permission_view && result.rows[0].permissions_course.has_course_permission_view;
                    // res.locals.authz_data.has_course_permission_edit = res.locals.authz_data.has_course_permission_edit && result.rows[0].permissions_course.has_course_permission_edit;
                    // res.locals.authz_data.has_course_permission_own = res.locals.authz_data.has_course_permission_own && result.rows[0].permissions_course.has_course_permission_own;
                    //
                    // // NOTE: When this code is all rewritten, you may want to throw an error if
                    // // the user tries to emulate another user with greater permissions, so that
                    // // it is clear why these permissions aren't granted.
                    //
                    // res.locals.user = res.locals.authz_data.user;
                    callback(null);
                });



                // const params = {
                //     authn_user_id: res.locals.authn_user.user_id,
                //     authn_role: res.locals.authz_data.authn_role,
                //     server_mode: res.locals.authz_data.authn_mode,
                //     req_date: res.locals.req_date,
                //     course_instance_id: req.params.course_instance_id,
                //     requested_uid: (req.cookies.pl_requested_uid ? req.cookies.pl_requested_uid : res.locals.authz_data.user.uid),
                //     requested_role: (req.cookies.pl_requested_role ? req.cookies.pl_requested_role : res.locals.authz_data.role),
                //     requested_mode: (req.cookies.pl_requested_mode ? req.cookies.pl_requested_mode : res.locals.authz_data.mode),
                //     requested_date: (req.cookies.pl_requested_date ? req.cookies.pl_requested_date : res.locals.req_date),
                // };
                // sqldb.queryZeroOrOneRow(sql.select_effective_authz_data, params, function(err, result) {
                //     if (ERR(err, callback)) return;
                //     if (result.rowCount == 0) {
                //         // The effective user has been denied access. For a real user, two things would be true:
                //         //
                //         //  1) authn_user would exist
                //         //  2) authz_data would not exist
                //         //
                //         // Unfortunately, for the effective user, both authn_user and authz_data exist but are
                //         // "wrong" in the sense that they are consistent with the real user and not the effective
                //         // user. This screws up various things on the error page.
                //         //
                //         // As a fix for now, we will remove authz_data and will set a flag saying that the
                //         // effective user has been denied access to the course instance - this will allow, for
                //         // example, the user dropdown in the navbar to be hidden. It is likely that a better
                //         // solution can be found when this code is all rewritten.
                //         delete res.locals.authz_data;
                //         res.locals.effective_user_has_no_access_to_course_instance = true;
                //
                //         // Tell the real user what happened and how to reset the effective user.
                //         let err = error.make(403, 'Access denied');
                //         err.info =  `<p>You have changed the effective user to one with these properties:</p>` +
                //                     `<div class="container"><pre class="bg-dark text-white rounded p-2">` +
                //                     `uid = ${params.requested_uid}\n` +
                //                     `role = ${params.requested_role}\n` +
                //                     `mode = ${params.requested_mode}\n` +
                //                     `</pre></div>` +
                //                     `<p>This user does not have access to the course instance <code>${res.locals.course_instance.short_name}</code> (with long name "${res.locals.course_instance.long_name}").` +
                //                     `<p>To reset the effective user, return to the <a href="${res.locals.homeUrl}">PrairieLearn home page</a>.</p>`;
                //         return callback(err);
                //     }
                //
                //     res.locals.authz_data.user = result.rows[0].user;
                //     res.locals.authz_data.role = result.rows[0].role;
                //     res.locals.authz_data.mode = result.rows[0].mode;
                //     res.locals.req_date = result.rows[0].req_date;
                //
                //     // Make sure that we never grant extra permissions
                //     res.locals.authz_data.has_instructor_view = res.locals.authz_data.has_instructor_view && result.rows[0].has_instructor_view;
                //     res.locals.authz_data.has_instructor_edit = res.locals.authz_data.has_instructor_edit && result.rows[0].has_instructor_edit;
                //     res.locals.authz_data.has_course_permission_view = res.locals.authz_data.has_course_permission_view && result.rows[0].permissions_course.has_course_permission_view;
                //     res.locals.authz_data.has_course_permission_edit = res.locals.authz_data.has_course_permission_edit && result.rows[0].permissions_course.has_course_permission_edit;
                //     res.locals.authz_data.has_course_permission_own = res.locals.authz_data.has_course_permission_own && result.rows[0].permissions_course.has_course_permission_own;
                //
                //     // NOTE: When this code is all rewritten, you may want to throw an error if
                //     // the user tries to emulate another user with greater permissions, so that
                //     // it is clear why these permissions aren't granted.
                //
                //     res.locals.user = res.locals.authz_data.user;
                //     callback(null);
                // });
            }
        ], (err) => {
            if (ERR(err, next)) return;
            debug('here');
            next();
        });
    });
};