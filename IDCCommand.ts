import {
    Control,
    ControlUpdateData
} from "@devctrl/common";
/*
* An interface used by various communicator classes for interacting with individual API commands.
*
*
 */

export interface IDCCommand {
    ctidList : string[];  // A list of the control template IDs for this command
    name : string; // A unique name for the command.  Used for logging

    /**
    * Get an array of "control templates" from the command.  Each control template will correspond to a Control object
    * that either exists or will be created on the DCDataModel.  control templates use CTIDs as placeholders for object
    * _id properties
    **/
    getControlTemplates() : Control[];

    //TODO: matchesReport() should take a Control argument

    matchesReport(line: string) : boolean; // Does this report line contain an update for this command?
    matchQueryResponse(line: string); // Is this line the query response we're looking for?
    matchUpdateResponse(control: Control, request: ControlUpdateData, line: string) : boolean; // Is this line an update response?
    parseQueryResponse(control: Control, line: string) : any; // Extract a control value from a query response
    parseReportValue(control: Control, line: string) : any; // Extract a control value from a report (unsolicited data update from Endpoint)
    parseUpdateResponse(control: Control, request: ControlUpdateData, line: string) : any; // Extract value from update response
    queryString() : string;  // The string to send to the endpoint to query this command

    /**
     *
     * @param {Control} control  The control to update
     * @param {ControlUpdateData} update Contains the value to update the control to
     * @returns {string} The string to send to the endpoint
     */
    updateString(control: Control, update: ControlUpdateData) : string;
    writeonly : boolean; // A writeonly command cannot be queried


    //TODO: remove these functions from the interface and replace them with matching functions
    //queryResponseMatchString() : string | RegExp;
    //updateResponseMatchString(request: ControlUpdateData) : string;
}