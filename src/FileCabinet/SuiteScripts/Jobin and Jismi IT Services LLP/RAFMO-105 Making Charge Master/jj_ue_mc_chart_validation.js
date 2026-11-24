/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 *
 * *********************************************************************************************************************************
 *
 * Rafmoh Bullion NS IN
 *
 * RAFMO-105 : Making Charge Master and Purity-Based Item Rate Calculation with Percentage and Per-Gram Charges
 *
 * *********************************************************************************************************************************
 *
 * Author : Jobin and Jismi
 *
 * Date Created : 20-November-2026
 *
 * COPYRIGHT © 2026 Jobin & Jismi IT Services LLP.
 * All rights reserved. This script is a proprietary product of Jobin & Jismi IT Services LLP and is protected by copyright
 * law and international treaties. Unauthorized reproduction or distribution of this script, or any portion of it,
 * may result in severe civil and criminal penalties and will be prosecuted to the maximum extent possible under law.
 *
 * Description : User event script that validates the Making Charge Master custom record (customrecord_jj_mc_chart).
 *                 beforeLoad   : the Approved checkbox is unchecked by default on create / copy.
 *                 beforeSubmit : (create, edit, xedit, copy) throws an error, so an invalid record cannot be saved, when
 *                                  1. Item or Vendor is empty                          (JJ_MC_MANDATORY)
 *                                  2. Making Charge % or Per Gram is negative          (JJ_MC_NEGATIVE)
 *                                  3. Both Making Charge % and Per Gram are zero       (JJ_MC_NO_CHARGE)
 *                                  4. Effective From is empty                          (JJ_MC_NO_FROM)
 *                                  5. Effective To is earlier than Effective From      (JJ_MC_DATE)
 *                                  6. An approved record for the same Item + Vendor overlaps the period
 *                                     (empty Effective To = open ended)                (JJ_MC_OVERLAP)
 *                              It also copies the Item's current Purity % onto the record (display only; PO pricing
 *                              always reads the Item live). Purity is not set on xedit, where setValue is not allowed.
 *                              For inline edit (xedit), values that were not edited are read from the old record.
 * REVISION HISTORY :
 *
 * @version 1.0 RAFMO-105 : 20-November-2026 : Created the initial build by JJ0494
 *
 * *********************************************************************************************************************************
 */
define(['N/search', 'N/error', 'N/format', './jj_cm_charge_master_rafmo105'],
    /**
     * @param {search} search
     * @param {error} error
     * @param {format} format
     * @param lib
     */
    (search, error, format, lib) => {

        const MC = lib.CFG.MC;

        /**
         * Defines the function definition that is executed before record is loaded.
         * @param {Object} scriptContext
         * @param {Record} scriptContext.newRecord - New record
         * @param {string} scriptContext.type - Trigger type; use values from the context.UserEventType enum
         * @param {Form} scriptContext.form - Current form
         * @param {ServletRequest} scriptContext.request - HTTP request information sent from the browser for a client action only.
         * @since 2015.2
         */
        const beforeLoad = (scriptContext) => {
            try {
                if (scriptContext.type === 'create' || scriptContext.type === 'copy') {
                    scriptContext.newRecord.setValue({
                        fieldId: MC.APPROVED,
                        value: false
                    });
                }
            } catch (e) {
                log.error('error @ beforeLoad', e);
            }
        }

        /**
         * Defines the function definition that is executed before record is submitted.
         * Errors are thrown (not swallowed) so that an invalid record cannot be saved.
         * @param {Object} scriptContext
         * @param {Record} scriptContext.newRecord - New record
         * @param {Record} scriptContext.oldRecord - Old record
         * @param {string} scriptContext.type - Trigger type; use values from the context.UserEventType enum
         * @since 2015.2
         */
        const beforeSubmit = (scriptContext) => {
            let type = scriptContext.type;
            if (['create', 'edit', 'xedit', 'copy'].indexOf(type) === -1) return;

            let rec = scriptContext.newRecord;
            let values = readValues(rec, scriptContext.oldRecord, type);
            log.debug('mc values', JSON.stringify(values));

            if (!values.item || !values.vendor) {
                throw createError('JJ_MC_MANDATORY', 'Item and Vendor are mandatory.');
            }
            // Copy the Item's current Purity % onto this record (create / edit / copy only;
            // setValue is not allowed on xedit). Display only - PO pricing always reads the Item live.
            if (type !== 'xedit') {
                rec.setValue({
                    fieldId: MC.PURITY,
                    value: lib.getItemInfo(values.item).purity
                });
            }
            if (values.percent < 0 || values.perGram < 0) {
                throw createError('JJ_MC_NEGATIVE', 'Making charge values cannot be negative.');
            }
            if (!(values.percent > 0 || values.perGram > 0)) {
                throw createError('JJ_MC_NO_CHARGE', 'At least one of Making Charge % or Making Charge per Gram must be greater than zero.');
            }
            if (!values.from) {
                throw createError('JJ_MC_NO_FROM', 'Effective From date is mandatory.');
            }
            if (values.to && values.to < values.from) {
                throw createError('JJ_MC_DATE', 'Effective To date cannot be earlier than Effective From date.');
            }
            if (values.approved) {
                let clashId = findOverlap(values, rec.id);
                if (clashId) {
                    throw createError('JJ_MC_OVERLAP',
                        'An approved Making Charge record (ID ' + clashId + ') already overlaps this period for the same Item and Vendor. ' +
                        'Change the dates or end-date the existing record first.');
                }
            }
        }

        /**
         * Defines the function definition that is executed after record is submitted.
         * @param {Object} scriptContext
         * @param {Record} scriptContext.newRecord - New record
         * @param {Record} scriptContext.oldRecord - Old record
         * @param {string} scriptContext.type - Trigger type; use values from the context.UserEventType enum
         * @since 2015.2
         */
        const afterSubmit = (scriptContext) => {

        }

        /**
         * Reads the record values. For inline edit (xedit) falls back to the old record
         * for fields that were not edited.
         * @param {Record} rec
         * @param {Record} oldRec
         * @param {string} type
         * @returns {Object}
         */
        function readValues(rec, oldRec, type) {
            let get = (fieldId) => {
                let value = rec.getValue({ fieldId: fieldId });
                if ((value === null || value === undefined || value === '') && type === 'xedit' && oldRec) {
                    value = oldRec.getValue({ fieldId: fieldId });
                }
                return value;
            };
            let approved = get(MC.APPROVED);
            return {
                item: get(MC.ITEM),
                vendor: get(MC.VENDOR),
                percent: lib.num(get(MC.PERCENT)),
                perGram: lib.num(get(MC.PER_GRAM)),
                from: get(MC.FROM_DATE),
                to: get(MC.TO_DATE),
                approved: approved === true || approved === 'T'
            };
        }

        /**
         * Finds an approved record for the same Item + Vendor whose dates overlap.
         * Overlap rule: existingFrom <= newTo AND newFrom <= existingTo (empty To = open ended).
         * @param {Object} values
         * @param {string|number} selfId - current record id (excluded from the search)
         * @returns {string|null} internal id of the overlapping record, or null
         */
        function findOverlap(values, selfId) {
            let filters = [
                [MC.ITEM, 'anyof', values.item], 'AND',
                [MC.VENDOR, 'anyof', values.vendor], 'AND',
                [MC.APPROVED, 'is', 'T'], 'AND',
                ['isinactive', 'is', 'F']
            ];
            if (selfId) {
                filters.push('AND', ['internalid', 'noneof', selfId]);
            }
            let clashId = null;
            search.create({
                type: MC.REC,
                filters: filters,
                columns: [MC.FROM_DATE, MC.TO_DATE]
            }).run().each(function (result) {
                let existingFrom = parseDate(result.getValue(MC.FROM_DATE));
                let existingTo = parseDate(result.getValue(MC.TO_DATE));
                let newTo = values.to || null;
                let startsBeforeNewEnds = !newTo || existingFrom <= newTo;
                let endsAfterNewStarts = !existingTo || values.from <= existingTo;
                if (startsBeforeNewEnds && endsAfterNewStarts) {
                    clashId = result.id;
                    return false;
                }
                return true;
            });
            return clashId;
        }

        /**
         * @param {string} value - date string in the user's format
         * @returns {Date|null}
         */
        function parseDate(value) {
            return value ? format.parse({ value: value, type: format.Type.DATE }) : null;
        }

        /**
         * @param {string} name
         * @param {string} message
         * @returns {Error}
         */
        function createError(name, message) {
            return error.create({ name: name, message: message, notifyOff: true });
        }

        return { beforeLoad, beforeSubmit, afterSubmit }

    });