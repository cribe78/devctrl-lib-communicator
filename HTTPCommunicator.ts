import {
    Control,
    ControlUpdateData,
    IEndpointStatus,
    IndexedDataSet
} from "@devctrl/common";
import {EndpointCommunicator, IEndpointCommunicatorConfig} from "./EndpointCommunicator";
import {HTTPCommand} from "./HTTPCommand";
import * as http from "http";

export class HTTPCommunicator extends EndpointCommunicator {
    commands: IndexedDataSet<HTTPCommand> = {};
    commandsByControl: IndexedDataSet<HTTPCommand> = {};
    pollTimer;

    constructor(config: IEndpointCommunicatorConfig) {
        super(config);
    }

    buildCommandList() : void {}


    closeConnection() {
        // Not really much to do here, no persistent connection is maintained
        this.updateStatus({
            polling: false,
            responsive: false
        });

    };

    executeCommandQuery(cmd: HTTPCommand) {
        if (cmd.writeonly) {
            this.log(`not querying writeonly command ${cmd.name}`, EndpointCommunicator.LOG_POLLING);
        }


        let control = this.controlsByCtid[cmd.controlData.ctid];
        let requestOptions = {
            hostname: this.config.endpoint.address,
            path: cmd.queryPath()
        };

        let requestPath = "http://" + requestOptions.hostname + requestOptions.path;
        this.log("sending request:" + requestPath, EndpointCommunicator.LOG_RAW_DATA);

        http.get(requestPath, (res) => {
            if (res.statusCode !== 200) {
                this.log("invalid status code response: " + res.statusCode);
            }
            else {
                //debug(`cmd ${cmd.name} successfully queried`);
                res.setEncoding('utf8');
                let body ='';
                res.on('data', (chunk) => { body += chunk});
                res.on('end', () => {
                    let val = cmd.parseQueryResponse(body);
                    if (typeof val !== 'undefined') {
                        this.log(`${cmd.name} response parsed: ${body},${val}`, EndpointCommunicator.LOG_POLLING);
                        this.config.controlUpdateCallback(control, val);
                        this.connectionConfirmed();
                    }
                    else {
                        this.log(`${cmd.name} update response did not match: ${body}`, EndpointCommunicator.LOG_MATCHING);
                    }
                });
            }
        })
            .on('error', (e) => {
                this.log(`Error on query: ${e.message}`);
                this.closeConnection();
            });
    }

    getControlTemplates() : IndexedDataSet<Control> {
        this.buildCommandList();

        for (let cmd in this.commands) {
            let controls = this.commands[cmd].getControls();

            for (let control of controls) {
                this.controlsByCtid[control.ctid] = control;
                this.commandsByControl[control.ctid] = this.commands[cmd];
            }
        }

        return this.controlsByCtid;
    }

    /**
     * Process a ControlUpdate, likely by sending a command to
     * a device
     * @param update ControlUpdateData The request control update
     */
    handleControlUpdateRequest(update: ControlUpdateData) {
        let control = this.controls[update.control_id];
        let command = this.commands[control.ctid];

        if (! command) {
            this.log(`No command found for control ${control.name}`);
            return;
        }

        let requestOptions = {
            hostname: this.config.endpoint.address,
            path: command.commandPath(update.value)
        };

        let requestPath = "http://" + requestOptions.hostname + requestOptions.path;
        this.log("sending request:" + requestPath, EndpointCommunicator.LOG_RAW_DATA);

        http.get(requestPath, (res) => {
            if (res.statusCode !== 200) {
                this.log("invalid status code response: " + res.statusCode);
            }
            else {
                //debug(`${command.name} set to ${update.value} successfully`);
                res.setEncoding('utf8');
                let body ='';
                res.on('data', (chunk) => { body += chunk});
                res.on('end', () => {
                    if (command.matchResponse(body)) {
                        let newVal = command.parseCommandResponse(body, update.value);
                        this.log(`${control.name} response successful, value: ${newVal}`, EndpointCommunicator.LOG_UPDATES);
                        this.config.controlUpdateCallback(control, newVal);
                        this.connectionConfirmed();
                    }
                    else {
                        this.log(`${control.name} update response did not match: ${body}`, EndpointCommunicator.LOG_MATCHING);
                    }
                });
            }
        }).on('error', (e) => {
            this.log(`Error on update request: ${e.message}`);
            this.closeConnection();
        });
    }


    initStatus() {
        let es = this.epStatus;
        es.reachable = false;
        es.connected = false;
        es.loggedIn = false;
        es.polling = false;
        es.responsive = false;
        es.ok = false;

        this.launchPing();
    }

    online() {
        if (! this.monitorTimer) {
            this.monitorTimer = setInterval(()=> {
                let offset = Date.now() - this.lastConfirmedCommunication;

                if (offset > 30000) {
                    this.updateStatus({ responsive: false });
                }
            }, 30000);
        }



        if (! this.pollTimer) {
            this.pollTimer = setInterval(() => {
                this.poll();
            }, 10000);
        }

        this.updateStatus({
            polling: true
        });
    };


    poll() {
        if (! this.epStatus.polling) {
            return;
        }

        this.log("polling device", EndpointCommunicator.LOG_POLLING);

        for (let id in this.controls) {
            let control = this.controls[id];

            if (control.poll) {
                let cmd = this.commandsByControl[control.ctid];

                if (cmd) {
                    this.executeCommandQuery(cmd);
                }
                else {
                    this.log("command not found for poll control " + control.ctid);
                }
            }
        }
    }


    updateStatus(statusChanges: IEndpointStatus) {
        let statusDiff= this.config.endpoint.statusDiff(statusChanges);
        let statusUnchanged = this.config.endpoint.compareStatus(statusChanges);
        let es = this.epStatus;

        if (! (es === this.config.endpoint.epStatus)) {
            this.log("epStatus mismathc!!!", EndpointCommunicator.LOG_STATUS);
        }

        let diffStr = "";
        // Set the new values
        for (let f in statusDiff) {
            es[f] = statusDiff[f];
            diffStr += f;
            diffStr += " ";
        }

        // connected and loggedIn don't apply, they should always mirror polling
        es.connected = es.loggedIn = es.polling;


        let statusStr = this.endpoint.statusStr;
        this.log("status update: " + statusStr, EndpointCommunicator.LOG_STATUS);

        if (! statusUnchanged) {
            //this.log("status diff: " + diffStr, EndpointCommunicator.LOG_STATUS);
            this.config.statusUpdateCallback(es);
        }


        // Figure out what to do next
        if (! es.enabled) {
            if (! es.reachable) {
                if (! es.connected) {
                    if (! es.loggedIn) {
                        if (! es.polling) {
                            if (!es.responsive) {
                                if (!es.ok) {
                                    // Stopped.  Nothing to do.
                                    return;
                                }
                                else {  // ok
                                    if (es.messengerConnected) {
                                        // Not really ok, update accordingly
                                        this.updateStatus({ok: false});
                                        return;
                                    }
                                }
                            }
                            else { // responsive
                                this.closeConnection();
                                return;
                            }
                        }
                        else { // polling
                            this.closeConnection();
                            return;
                        }
                    }
                    else { // loggedIn
                        this.closeConnection();
                        return;
                    }
                }
                else { // connected
                    this.closeConnection();
                    return;
                }
            }
            else { // reachable
                if (es.connected) {
                    this.closeConnection();
                    return;
                }
            }
        }
        else { // enabled
            if (! es.reachable) {
                // Enabled, not reachable, nothing to do
                return;
            }
            else { // reachable
                if (! es.polling) {
                    this.online();
                }
                else { // polling
                    if (! es.responsive) {
                        if (statusDiff.responsive === false) {
                            // Disconnect and attempt to reconnect
                            this.closeConnection();
                        }
                    }
                    else { // responsive
                        if (! es.ok) {
                            this.updateStatus({ok : true });
                        }
                    }
                }
            }
        }
    }

}
